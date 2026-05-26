import type { RenderedMessage } from "../prompt/promptTypes.js";
import type {
    GenerationMode as LlmResponseMode,
    ModelClient,
    StructuredOutputSchema,
    ModelToolCall,
    ModelUsage,
    ModelStreamResult,
} from "../llm/modelClient.js";
import { createNoopPersonaFlowLogger, type PersonaFlowLogger, type PersonaFlowPromptLogger } from "../chatTurn/personaFlowLogger.js";
import type { ModelCallPurpose } from "@ss-ai/contracts";
import type { AppStores } from "../stores/appStores.js";

export interface PersonaModelRequest {
    userId: string;
    characterId: string;
    messages: RenderedMessage[];
    modelCallPurpose: ModelCallPurpose;
    llmResponseMode?: LlmResponseMode;
    structuredOutputSchema?: StructuredOutputSchema;
}

export interface PersonaModelResponse {
    output: string;
    model: string;
    requestId: string;
    llmResponseMode: LlmResponseMode;
    structuredOutput?: unknown;
    toolCalls: ModelToolCall[];
    usage?: ModelUsage;
    streamCompleted?: boolean;
    streamFinishReason?: string;
}

export interface PersonaModelRuntimeDependencies {
    modelClient: ModelClient;
    appStores: AppStores;
    promptLogger: PersonaFlowPromptLogger;
    logger?: PersonaFlowLogger;
}

function extractStructuredOutputText(output: unknown): string {
    if (!output || typeof output !== "object") {
        return "";
    }
    const replyText = (output as { replyText?: unknown }).replyText;
    return typeof replyText === "string" ? replyText : "";
}

export class ModelRuntime {
    private readonly logger: PersonaFlowLogger;

    constructor(private readonly deps: PersonaModelRuntimeDependencies) {
        this.logger = deps.logger ?? createNoopPersonaFlowLogger();
    }

    private async resolveProviderModelRuntime(
        userId: string,
        characterId: string,
        modelCallPurpose: ModelCallPurpose): Promise<{
            provider: string;
            model: string;
            encryptedApiKey: string;
        }> {
        this.logger.verbose("persona-flow/model: resolving runtime", {
            userId: userId,
            characterId: characterId,
            modelCallPurpose,
        });
        const prefs = await this.deps.appStores.userPreferences.getUserPreferences(userId);
        const { provider, model } = prefs?.modelAssignments?.[modelCallPurpose] ?? {};

        if (!provider || !model) {
            throw new Error(`${this.toPurposeLabel(modelCallPurpose)} model is not configured. Please set it in Settings -> Model Assignment.`);
        }

        const credential = await this.deps.appStores.providerCredential.getCredential({
            userId: userId,
            provider: provider,
        });
        if (!credential) {
            throw new Error(`API key is not set for provider: ${provider}. userId: ${userId}`);
        }

        this.logger.debug("persona-flow/model: runtime resolved", {
            userId: userId,
            characterId: characterId,
            modelCallPurpose: modelCallPurpose,
            provider,
            model,
        });

        return {
            provider,
            model,
            encryptedApiKey: credential.encryptedApiKey,
        };
    }

    private toPurposeLabel(modelCallPurpose: string): string {
        if (!modelCallPurpose) {
            return "Model call purpose";
        }
        return modelCallPurpose.charAt(0).toUpperCase() + modelCallPurpose.slice(1);
    }

    private writePromptLog(
        requestId: string,
        request: PersonaModelRequest,
        model: string,
        payload: {
            status: "completed" | "failed";
            outputText: string;
            structuredOutput?: unknown;
            toolCalls: ModelToolCall[];
            usage?: ModelUsage;
            streamCompleted?: boolean;
            streamFinishReason?: string;
            error?: string;
        },
    ): void {
        this.deps.promptLogger?.writePromptLog({
            timestamp: new Date().toISOString(),
            requestId,
            model: model,
            messages: request.messages,
            output: JSON.stringify({
                mode: request.llmResponseMode ?? "non-structured",
                modelCallPurpose: request.modelCallPurpose ?? "chat.main",
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

    async chat(request: PersonaModelRequest): Promise<PersonaModelResponse> {
        const requestId = crypto.randomUUID();
        const llmResponseMode: LlmResponseMode = request.llmResponseMode ?? "non-structured";
        const { provider, model, encryptedApiKey } = await this.resolveProviderModelRuntime(
            request.userId,
            request.characterId,
            request.modelCallPurpose,
        );

        this.logger.verbose("persona-flow/model: chat request", {
            requestId,
            llmResponseMode,
            modelCallPurpose: request.modelCallPurpose,
            messages: request.messages,
        });

        let output = "";
        let structuredOutput: unknown;
        let toolCalls: ModelToolCall[] = [];
        let usage: ModelUsage | undefined;

        try {
            const result = await this.deps.modelClient.generate({
                provider,
                model,
                encryptedApiKey,
                messages: request.messages,
                structuredOutputSchema: llmResponseMode === "structured" ? request.structuredOutputSchema : undefined,
            });

            if (llmResponseMode === "structured") {
                if (!("structuredOutput" in result)) {
                    throw new Error("Model client returned non-structured result for structured request.");
                }

                structuredOutput = result.structuredOutput;
                toolCalls = result.toolCalls;
                usage = result.usage;
                output = extractStructuredOutputText(structuredOutput);
            } else {
                if (!("output" in result)) {
                    throw new Error("Model client returned structured result for non-structured request.");
                }

                output = result.output;
                toolCalls = result.toolCalls;
                usage = result.usage;
            }
        } catch (err: unknown) {
            const errorMessage = err instanceof Error ? err.message : "Unknown error";
            this.logger.error("persona-flow/model: chat failed", {
                requestId,
                llmResponseMode: llmResponseMode,
                modelCallPurpose: request.modelCallPurpose,
                error: errorMessage,
            });
            this.writePromptLog(requestId, request, model, {
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
            this.logger.debug("persona-flow/model: tool call requested (TODO)", {
                requestId,
                modelCallPurpose: request.modelCallPurpose,
                toolCall,
            });
        }

        this.logger.verbose("persona-flow/model: chat completed", {
            requestId,
            llmResponseMode,
            modelCallPurpose: request.modelCallPurpose,
            output,
            structuredOutput,
            toolCallCount: toolCalls.length,
            usage,
        });

        this.writePromptLog(requestId, request, model, {
            status: "completed",
            outputText: output,
            structuredOutput,
            toolCalls,
            usage,
        });

        return {
            output,
            model: model,
            requestId,
            llmResponseMode: llmResponseMode,
            toolCalls,
            usage,
            ...(structuredOutput ? { structuredOutput } : {}),
        };
    }

    async chatStream(request: PersonaModelRequest & { onTextDelta?: (delta: string) => void }): Promise<PersonaModelResponse & ModelStreamResult> {
        const requestId = crypto.randomUUID();
        const mode: LlmResponseMode = request.llmResponseMode ?? "non-structured";
        const modelCallPurpose = request.modelCallPurpose ?? "chat.main";
        const { provider, model, encryptedApiKey } = await this.resolveProviderModelRuntime(
            request.userId,
            request.characterId,
            modelCallPurpose as ModelCallPurpose,
        );

        if (mode !== "non-structured") {
            this.logger.warn("persona-flow/model: chatStream called with unsupported mode", {
                requestId,
                mode,
                modelCallPurpose,
            });
            throw new Error("PersonaFlow chatStream currently supports only non-structured mode.");
        }

        this.logger.verbose("persona-flow/model: chatStream request", {
            requestId,
            mode,
            modelCallPurpose,
            messages: request.messages,
        });

        let streamResult: ModelStreamResult | undefined;
        let streamError: string | undefined;

        try {
            streamResult = await this.deps.modelClient.generateNonStructuredStream(
                {
                    provider,
                    model,
                    encryptedApiKey,
                    messages: request.messages,
                },
                {
                    onTextDelta: request.onTextDelta,
                    onToolCall: (toolCall) => {
                        this.logger.debug("persona-flow/model: stream tool call requested (TODO)", {
                            requestId,
                            modelCallPurpose,
                            toolCall,
                        });
                    },
                },
            );
        } catch (err: unknown) {
            streamError = err instanceof Error ? err.message : "Unknown error";
            this.logger.error("persona-flow/model: chatStream failed", {
                requestId,
                mode,
                modelCallPurpose,
                error: streamError,
            });
            throw err;
        } finally {
            this.writePromptLog(requestId, request, model, {
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
            this.logger.error("persona-flow/model: chatStream missing stream result", {
                requestId,
                mode,
                modelCallPurpose,
            });
            throw new Error("PersonaFlow chatStream ended without a stream result.");
        }

        this.logger.verbose("persona-flow/model: chatStream completed", {
            requestId,
            mode,
            modelCallPurpose,
            outputLength: streamResult.output.length,
            toolCallCount: streamResult.toolCalls.length,
            usage: streamResult.usage,
            streamCompleted: streamResult.completed,
            finishReason: streamResult.finishReason,
        });

        if (!streamResult.completed) {
            this.logger.warn("persona-flow/model: stream ended without completion marker", {
                requestId,
                modelCallPurpose,
                finishReason: streamResult.finishReason,
            });
        }

        return {
            output: streamResult.output,
            model: model,
            requestId,
            llmResponseMode: mode,
            toolCalls: streamResult.toolCalls,
            usage: streamResult.usage,
            completed: streamResult.completed,
            finishReason: streamResult.finishReason,
            streamCompleted: streamResult.completed,
            streamFinishReason: streamResult.finishReason,
        };
    }
}
