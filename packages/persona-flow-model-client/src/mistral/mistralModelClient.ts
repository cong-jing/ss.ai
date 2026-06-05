import type {
    ModelGenerationResult,
    ModelGenerationInput,
    ModelStreamCallbacks,
    ModelStreamResult,
    ModelToolCall,
    ModelUsage,
    PersonaFlowLogger,
} from "@ss-ai/persona-flow";
import type { Mistral as MistralSDKClient } from "@mistralai/mistralai";
import {
    extractStructuredOutput,
    extractText,
    extractTextDelta,
    extractToolCallsFromMessage,
    extractUsage,
    normalizeToolCall,
    toSdkMessages,
} from "./messageTransforms.js";
import { toMistralToolRequest } from "./mistralToolAdapter.js";
import { withTimeout } from "./timeout.js";
import { ModelAdapter } from "../modelAdapter.js";

type MistralSDKModule = typeof import("@mistralai/mistralai");

interface MistralModelClientOptions {
    apiKey: string;
    apiUrl: string;
    timeoutMs: number;
    maxRetries?: number;
    logger?: PersonaFlowLogger;
}

export class MistralModelClient implements ModelAdapter {
    private clientPromise: Promise<MistralSDKClient> | null = null;

    constructor(private readonly options: MistralModelClientOptions) { }

    private async getClient(): Promise<MistralSDKClient> {
        if (!this.clientPromise) {
            const dynamicImport = new Function("modulePath", "return import(modulePath)") as (modulePath: string) => Promise<MistralSDKModule>;

            this.clientPromise = dynamicImport("@mistralai/mistralai").then((sdkModule) => {
                const mistral = new sdkModule.Mistral({
                    apiKey: this.options.apiKey,
                    serverURL: this.options.apiUrl,
                });

                return mistral;
            });
        }

        return this.clientPromise;
    }


    async generate(input: ModelGenerationInput): Promise<ModelGenerationResult> {
        const client = await this.getClient();
        const responseFormat = input.structuredOutputSchema ?? { type: "text" };
        const toolRequest = toMistralToolRequest(input);

        const response = await withTimeout(
            client.chat.complete({
                model: input.model,
                messages: toSdkMessages(input),
                responseFormat,
                ...toolRequest,
            }),
            this.options.timeoutMs,
            input.structuredOutputSchema ? "Mistral structured request" : "Mistral non-structured request",
        );

        const firstMessage = (response as {
            choices?: Array<{
                message?: unknown;
            }>;
        }).choices?.[0]?.message;

        if (input.structuredOutputSchema) {
            return {
                structuredOutput: extractStructuredOutput(response),
                toolCalls: extractToolCallsFromMessage(firstMessage),
                usage: extractUsage(response),
            };
        }

        const toolCalls = extractToolCallsFromMessage(firstMessage);
        let output = "";
        try {
            output = extractText(response);
        } catch (error: unknown) {
            if (toolCalls.length === 0) {
                throw error;
            }
        }

        return {
            output,
            toolCalls,
            usage: extractUsage(response),
        };
    }

    async generateStream(_input: ModelGenerationInput, _callbacks?: ModelStreamCallbacks): Promise<ModelStreamResult> {
        // TODO: implement real streaming once we settle on tool-call delta accumulation.
        // The previous draft tried to forward `submit_turn_events` tools to Mistral's stream API,
        // but Mistral returns toolCall arguments as fragmented deltas that need to be merged by
        // `index` before they can be JSON.parse-d. Until that's done, fall back to the non-stream
        // path via `ModelRuntime.chat()` / `ChatTurnService.streamTurn()` (which already emits the
        // full reply once) instead of producing partial / corrupt turnEvents.
        throw new Error("MistralModelClient.generateStream is not implemented yet.");
    }

    async listModels(): Promise<string[]> {
        const client = await this.getClient();
        const response = await client.models.list();
        const items = Array.isArray(response?.data) ? response.data : [];

        this.options.logger?.debug(`Fetched ${items.length} models from Mistral`, { rawResponse: response });

        const names = items
            .map((item) => {
                if (item && typeof item === "object" && "id" in item) {
                    const idValue = (item as { id?: unknown }).id;
                    return typeof idValue === "string" ? idValue : "";
                }

                return "";
            })
            .filter((name) => Boolean(name));

        return names;
    }
}
