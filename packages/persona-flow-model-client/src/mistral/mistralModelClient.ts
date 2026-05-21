import type {
    ModelClient,
    ModelGenerationInput,
    ModelNonStructuredResult,
    ModelStreamCallbacks,
    ModelStreamResult,
    ModelToolCall,
    ModelUsage,
    PersonaFlowLogger,
} from "@ss-ai/persona-flow";
import type { Mistral as MistralSDKClient } from "@mistralai/mistralai";
import {
    extractStructuredResult,
    extractText,
    extractTextDelta,
    extractToolCallsFromMessage,
    extractUsage,
    normalizeToolCall,
    toSdkMessages,
} from "./messageTransforms.js";
import { mistralStructuredOutputSchema } from "./structuredOutputSchema.js";
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


    async generateNonStructured(input: ModelGenerationInput): Promise<ModelNonStructuredResult> {
        const client = await this.getClient();

        const response = await withTimeout(
            client.chat.complete({
                model: input.model,
                messages: toSdkMessages(input),
                responseFormat: { type: "text" },
            }),
            this.options.timeoutMs,
            "Mistral non-structured request",
        );

        const firstMessage = (response as {
            choices?: Array<{
                message?: unknown;
            }>;
        }).choices?.[0]?.message;

        return {
            output: extractText(response),
            toolCalls: extractToolCallsFromMessage(firstMessage),
            usage: extractUsage(response),
        };
    }

    async generateNonStructuredStream(input: ModelGenerationInput, callbacks?: ModelStreamCallbacks): Promise<ModelStreamResult> {
        const client = await this.getClient();

        const stream = await withTimeout(
            client.chat.stream({
                model: input.model,
                messages: toSdkMessages(input),
                responseFormat: { type: "text" },
            }),
            this.options.timeoutMs,
            "Mistral non-structured stream request",
        );

        let output = "";
        const toolCalls: ModelToolCall[] = [];
        let usage: ModelUsage | undefined;
        let completed = false;
        let finishReason: string | undefined;

        for await (const event of stream as AsyncIterable<{ data?: { choices?: Array<{ delta?: { content?: unknown; toolCalls?: unknown[] | null }; finishReason?: unknown; finish_reason?: unknown }>; usage?: unknown } }>) {
            const data = event?.data;
            const choices = data?.choices;
            if (!Array.isArray(choices)) {
                continue;
            }

            const eventUsage = extractUsage({ usage: data?.usage });
            if (eventUsage) {
                usage = eventUsage;
            }

            for (const choice of choices) {
                const delta = choice?.delta;
                if (!delta) {
                    const rawFinishReason = choice?.finishReason ?? choice?.finish_reason;
                    if (typeof rawFinishReason === "string" && rawFinishReason.length > 0) {
                        completed = true;
                        finishReason = rawFinishReason;
                    }
                    continue;
                }

                const textDelta = extractTextDelta(delta.content);
                if (textDelta) {
                    output += textDelta;
                    callbacks?.onTextDelta?.(textDelta);
                }

                if (Array.isArray(delta.toolCalls) && delta.toolCalls.length > 0) {
                    for (const rawToolCall of delta.toolCalls) {
                        const normalized = normalizeToolCall(rawToolCall);
                        toolCalls.push(normalized);
                        callbacks?.onToolCall?.(normalized);
                    }
                }

                const rawFinishReason = choice?.finishReason ?? choice?.finish_reason;
                if (typeof rawFinishReason === "string" && rawFinishReason.length > 0) {
                    completed = true;
                    finishReason = rawFinishReason;
                }
            }
        }

        return {
            output,
            toolCalls,
            usage,
            completed,
            finishReason,
        };
    }

    async generateStructured(input: ModelGenerationInput) {
        const client = await this.getClient();

        const response = await withTimeout(
            client.chat.parse({
                model: input.model,
                messages: toSdkMessages(input),
                responseFormat: mistralStructuredOutputSchema,
            }),
            this.options.timeoutMs,
            "Mistral structured request",
        );

        return extractStructuredResult(response);
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
