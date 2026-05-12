import { getGlobalLogger } from "../util/logger.js";
import { PromptLogger } from "../util/promptLog.js";
import { PlaceholderModelClient } from "./clients/placeholderModelClient.js";
import { AgentConfig, ChatRequest, ChatResponse, GenerationMode, ModelClient, ModelStreamResult, ModelToolCall, ModelUsage } from "./types.js";

export interface AgentDependencies {
    modelClient?: ModelClient;
    promptLogger?: PromptLogger;
}

export class AgentService {
    private readonly logger = getGlobalLogger();
    private readonly modelClient: ModelClient;
    private readonly promptLogger: PromptLogger;

    constructor(
        private readonly config: AgentConfig,
        dependencies: AgentDependencies = {}
    ) {
        this.modelClient = dependencies.modelClient ?? new PlaceholderModelClient();
        this.promptLogger = dependencies.promptLogger ?? PromptLogger.disabled();
    }

    private writePromptLog(
        requestId: string,
        request: ChatRequest,
        payload: {
            status: "completed" | "failed";
            outputText: string;
            structuredOutput?: ChatResponse["structuredOutput"];
            toolCalls: ModelToolCall[];
            usage?: ModelUsage;
            streamCompleted?: boolean;
            streamFinishReason?: string;
            error?: string;
        },
    ): void {
        this.promptLogger.write({
            timestamp: new Date().toISOString(),
            requestId,
            model: this.config.model,
            messages: request.messages,
            output: JSON.stringify({
                mode: request.mode ?? "non-structured",
                status: payload.status,
                outputText: payload.outputText,
                structuredOutput: payload.structuredOutput,
                toolCalls: payload.toolCalls,
                usage: payload.usage,
                stream: {
                    completed: payload.streamCompleted,
                    finishReason: payload.streamFinishReason,
                },
                error: payload.error,
            }, null, 2),
        });
    }

    async chat(request: ChatRequest): Promise<ChatResponse> {
        const requestId = crypto.randomUUID();
        const mode: GenerationMode = request.mode ?? "non-structured";

        this.logger.verbose("Agent chat: sending messages to LLM", {
            requestId,
            mode,
            messages: request.messages,
        });

        let output = "";
        let structuredOutput: ChatResponse["structuredOutput"];
        let toolCalls: ModelToolCall[] = [];
        let usage: ModelUsage | undefined;

        try {
            if (mode === "structured") {
                const structuredResult = await this.modelClient.generateStructured({
                    messages: request.messages,
                    timeoutMs: this.config.timeoutMs,
                });

                structuredOutput = structuredResult.structuredOutput;
                toolCalls = structuredResult.toolCalls;
                usage = structuredResult.usage;
                output = structuredOutput.action === "reply"
                    ? structuredOutput.replyText
                    : "";
            } else {
                const result = await this.modelClient.generateNonStructured({
                    messages: request.messages,
                    timeoutMs: this.config.timeoutMs,
                });
                output = result.output;
                toolCalls = result.toolCalls;
                usage = result.usage;
            }
        } catch (err: unknown) {
            const errorMessage = err instanceof Error ? err.message : "Unknown error";
            this.writePromptLog(requestId, request, {
                status: "failed",
                outputText: output,
                structuredOutput,
                toolCalls,
                usage,
                error: errorMessage,
            });
            throw err;
        }

        for (const toolCall of toolCalls) {
            this.logger.verbose("Agent chat: tool call requested (TODO: execute function)", {
                requestId,
                toolCall,
            });
        }

        this.logger.verbose("Agent chat: completed", {
            requestId,
            mode,
            output,
            structuredOutput,
            toolCallCount: toolCalls.length,
            usage,
        });

        this.writePromptLog(requestId, request, {
            status: "completed",
            outputText: output,
            structuredOutput,
            toolCalls,
            usage,
        });

        return {
            output,
            model: this.config.model,
            requestId,
            mode,
            toolCalls,
            usage,
            ...(structuredOutput ? { structuredOutput } : {}),
        };
    }

    async chatStream(request: ChatRequest & { onTextDelta?: (delta: string) => void }): Promise<ChatResponse & ModelStreamResult> {
        const requestId = crypto.randomUUID();
        const mode: GenerationMode = request.mode ?? "non-structured";

        if (mode !== "non-structured") {
            throw new Error("Agent chatStream currently supports only non-structured mode.");
        }

        this.logger.verbose("Agent chatStream: sending messages to LLM", {
            requestId,
            mode,
            messages: request.messages,
        });

        let streamResult: ModelStreamResult | undefined;
        let streamError: string | undefined;

        try {
            streamResult = await this.modelClient.generateNonStructuredStream(
                {
                    messages: request.messages,
                    timeoutMs: this.config.timeoutMs,
                },
                {
                    onTextDelta: request.onTextDelta,
                    onToolCall: (toolCall) => {
                        this.logger.verbose("Agent chatStream: tool call requested (TODO: execute function)", {
                            requestId,
                            toolCall,
                        });
                    },
                },
            );
        } catch (err: unknown) {
            streamError = err instanceof Error ? err.message : "Unknown error";
            throw err;
        } finally {
            this.writePromptLog(requestId, request, {
                status: streamError ? "failed" : "completed",
                outputText: streamResult?.output ?? "",
                toolCalls: streamResult?.toolCalls ?? [],
                usage: streamResult?.usage,
                streamCompleted: streamResult?.completed,
                streamFinishReason: streamResult?.finishReason,
                error: streamError,
            });
        }

        if (!streamResult) {
            throw new Error("Agent chatStream ended without a stream result.");
        }

        this.logger.verbose("Agent chatStream: completed", {
            requestId,
            mode,
            outputLength: streamResult.output.length,
            toolCallCount: streamResult.toolCalls.length,
            usage: streamResult.usage,
            streamCompleted: streamResult.completed,
            finishReason: streamResult.finishReason,
        });

        if (!streamResult.completed) {
            this.logger.warn("Agent chatStream: stream ended without completion marker", {
                requestId,
                finishReason: streamResult.finishReason,
            });
        }

        return {
            output: streamResult.output,
            model: this.config.model,
            requestId,
            mode,
            toolCalls: streamResult.toolCalls,
            usage: streamResult.usage,
            completed: streamResult.completed,
            finishReason: streamResult.finishReason,
            streamCompleted: streamResult.completed,
            streamFinishReason: streamResult.finishReason,
        };
    }

    async listModels(): Promise<string[]> {
        return this.modelClient.listModels();
    }
}
