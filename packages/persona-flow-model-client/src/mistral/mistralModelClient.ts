import type {
    ModelGenerationResult,
    ModelGenerationInput,
    ModelStreamCallbacks,
    ModelStreamResult,
    ModelToolCall,
    ModelToolCallDelta,
    ModelUsage,
    PersonaFlowLogger,
} from "@ss-ai/persona-flow";
import type { Mistral as MistralSDKClient } from "@mistralai/mistralai";
import {
    accumulateToolCallDelta,
    extractStructuredOutput,
    extractText,
    extractTextDelta,
    extractToolCallsFromMessage,
    extractUsage,
    isMistralMessageContentEmpty,
    normalizeStreamToolCallDeltas,
    normalizeToolCallArguments,
    toSdkMessages,
    type ToolCallAccumulator,
} from "./messageTransforms.js";
import { generateFakeSubmitTurnEventsStream } from "./fakeStream.js";
import { toMistralToolRequest } from "./mistralToolAdapter.js";
import { withTimeout } from "./timeout.js";
import { ModelAdapter } from "../modelAdapter.js";

type MistralSDKModule = typeof import("@mistralai/mistralai");

// Local stream smoke-test switch. Set to true to bypass Mistral and emit fake
// submit_turn_events tool-call argument deltas for roughly 10 seconds.
const ENABLE_FAKE_STREAM_DELTAS = false;

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
        if (toolCalls.length > 0 && isMistralMessageContentEmpty(firstMessage)) {
            this.options.logger?.verbose("Mistral non-stream tool response did not include text content.", {
                toolCallCount: toolCalls.length,
            });

            return {
                output: "",
                toolCalls,
                usage: extractUsage(response),
            };
        }

        const output = extractText(response);

        return {
            output,
            toolCalls,
            usage: extractUsage(response),
        };
    }

    async generateStream(input: ModelGenerationInput, callbacks?: ModelStreamCallbacks): Promise<ModelStreamResult> {
        if (ENABLE_FAKE_STREAM_DELTAS) {
            return generateFakeSubmitTurnEventsStream(input, callbacks);
        }

        const streamStartedAt = Date.now();
        const client = await this.getClient();
        const toolRequest = toMistralToolRequest(input);
        const responseFormat = input.structuredOutputSchema ?? { type: "text" };

        const stream = await withTimeout(
            client.chat.stream({
                model: input.model,
                messages: toSdkMessages(input),
                responseFormat,
                ...toolRequest,
            }),
            this.options.timeoutMs,
            input.structuredOutputSchema ? "Mistral structured stream request" : "Mistral stream request",
        );

        let output = "";
        const toolAccumulators = new Map<number, ToolCallAccumulator>();
        let usage: ModelUsage | undefined;
        let finishReason: string | undefined;
        let completed = false;
        let firstTextDeltaAt: number | undefined;
        let firstTextDeltaChars = 0;
        let firstToolCallDeltaAt: number | undefined;
        let firstToolCallDeltaBytes = 0;

        const iterator = stream[Symbol.asyncIterator]();

        try {
            while (true) {
                const next = await withTimeout(
                    iterator.next(),
                    this.options.timeoutMs,
                    "Mistral stream chunk",
                );
                if (next.done) break;

                const event = next.value;
                const chunk = (event && typeof event === "object" && "data" in event)
                    ? (event as { data?: unknown }).data
                    : event;
                const choice = (chunk as {
                    choices?: Array<{
                        delta?: unknown;
                        finishReason?: unknown;
                        finish_reason?: unknown;
                    }>;
                })?.choices?.[0];

                if (!choice) {
                    const possibleUsage = extractUsage(chunk);
                    if (possibleUsage) usage = possibleUsage;
                    continue;
                }

                const delta = (choice as { delta?: unknown }).delta;
                if (delta) {
                    const textDelta = extractTextDelta((delta as { content?: unknown }).content);
                    if (textDelta) {
                        if (firstTextDeltaAt === undefined) {
                            firstTextDeltaAt = Date.now();
                            firstTextDeltaChars = textDelta.length;
                        }
                        output += textDelta;
                        callbacks?.onTextDelta?.(textDelta);
                    }

                    const toolDeltas = normalizeStreamToolCallDeltas(delta);
                    for (const toolDelta of toolDeltas) {
                        if (firstToolCallDeltaAt === undefined && toolDelta.argumentsDelta) {
                            firstToolCallDeltaAt = Date.now();
                            firstToolCallDeltaBytes = toolDelta.argumentsDelta.length;
                        }
                        accumulateToolCallDelta(toolAccumulators, toolDelta);
                        callbacks?.onToolCallDelta?.(toolDelta);
                    }
                }

                const choiceFinish = (choice as { finishReason?: unknown; finish_reason?: unknown });
                const reason = typeof choiceFinish.finishReason === "string"
                    ? choiceFinish.finishReason
                    : (typeof choiceFinish.finish_reason === "string" ? choiceFinish.finish_reason : undefined);
                if (reason) {
                    finishReason = reason;
                    completed = true;
                }

                const chunkUsage = extractUsage(chunk);
                if (chunkUsage) {
                    usage = chunkUsage;
                }
            }
        } catch (err: unknown) {
            try {
                await iterator.return?.();
            } catch (closeErr: unknown) {
                this.options.logger?.warn("Mistral stream iterator close failed", {
                    error: closeErr instanceof Error ? closeErr.message : "Unknown error",
                });
            }
            this.options.logger?.error("Mistral stream iteration failed", {
                error: err instanceof Error ? err.message : "Unknown error",
            });
            throw err;
        }

        const toolCalls: ModelToolCall[] = Array.from(toolAccumulators.values())
            .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
            .map(toModelToolCall);

        for (const toolCall of toolCalls) {
            callbacks?.onToolCall?.(toolCall);
        }

        const streamCompletedAt = Date.now();
        this.options.logger?.debug("Mistral stream timing", {
            model: input.model,
            firstTextDeltaChars,
            firstToolCallDeltaBytes,
            msToFirstTextDelta: firstTextDeltaAt !== undefined ? firstTextDeltaAt - streamStartedAt : null,
            msToFirstToolCallDelta: firstToolCallDeltaAt !== undefined ? firstToolCallDeltaAt - streamStartedAt : null,
            msToStreamComplete: streamCompletedAt - streamStartedAt,
            toolCallCount: toolCalls.length,
            completed,
            finishReason,
        });

        let structuredOutput: unknown | undefined;
        if (input.structuredOutputSchema) {
            if (output.length === 0) {
                this.options.logger?.warn("Mistral structured stream returned no text output", {
                    model: input.model,
                    finishReason,
                });
            } else {
                try {
                    structuredOutput = JSON.parse(output);
                } catch (err: unknown) {
                    this.options.logger?.error("Failed to parse Mistral structured stream output as JSON", {
                        model: input.model,
                        error: err instanceof Error ? err.message : "Unknown error",
                        outputLength: output.length,
                    });
                    throw new Error(
                        `Mistral structured stream returned invalid JSON: ${err instanceof Error ? err.message : "Unknown error"}`,
                    );
                }
            }
        }

        return {
            output,
            ...(structuredOutput !== undefined ? { structuredOutput } : {}),
            toolCalls,
            usage,
            completed,
            finishReason,
        };
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

function toModelToolCall(accumulator: ToolCallAccumulator): ModelToolCall {
    // Mistral / OpenAI tool-call arguments are JSON text emitted as multiple
    // fragments. Normalize the merged buffer to a parsed value here so the
    // ModelToolCall contract delivers a structured `arguments` to downstream
    // consumers, while still preserving the raw text under `argumentsRaw` for
    // prompt logs / debugging when parsing fails.
    const { parsed, raw } = normalizeToolCallArguments(
        accumulator.argumentsBuffer ? accumulator.argumentsBuffer : undefined,
    );
    return {
        ...(accumulator.id ? { id: accumulator.id } : {}),
        ...(accumulator.type ? { type: accumulator.type } : {}),
        ...(accumulator.index !== undefined ? { index: accumulator.index } : {}),
        ...(accumulator.functionName ? { functionName: accumulator.functionName } : {}),
        ...(parsed !== undefined ? { arguments: parsed } : {}),
        ...(raw !== undefined ? { argumentsRaw: raw } : {}),
    };
}
