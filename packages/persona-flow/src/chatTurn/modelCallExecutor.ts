import type { CommonRoleplayTurnOutput } from "../structuredOutput/commonRoleplayTurnOutput.js";
import type { RenderedMessage } from "../prompt/promptTypes.js";
import type {
    GenerationMode as LlmResponseMode,
    ModelClient,
    ModelToolCall,
    ModelUsage,
    ModelStreamResult,
} from "../llm/modelClient.js";
import { createNoopPersonaFlowLogger, PersonaFlowPromptLogger, type PersonaFlowLogger } from "./personaFlowLogger.js";
import { ModelCallPurpose } from "@ss-ai/contracts";
import { AppStores } from "../stores/appStores.js";

export interface PersonaChatRequest {
    userId: string;
    characterId: string;
    messages: RenderedMessage[];
    modelCallPurpose: ModelCallPurpose;
    llmResponseMode?: LlmResponseMode;
}

export interface PersonaChatResponse {
    output: string;
    model: string;
    requestId: string;
    llmResponseMode: LlmResponseMode;
    structuredOutput?: CommonRoleplayTurnOutput;
    toolCalls: ModelToolCall[];
    usage?: ModelUsage;
    streamCompleted?: boolean;
    streamFinishReason?: string;
}


export type ModelSelector =
    (userId: string, characterId: string, modelCallPurpose: ModelCallPurpose) => Promise<{ provider: string; model: string } | null>;
export type ModelCredentialResolver =
    (userId: string, provider: string) => Promise<{ apiKeyEncrypted: string } | null>;

export interface PersonaFlowModelServiceDependencies {
    modelClient: ModelClient;
    appStores: AppStores;
    promptLogger: PersonaFlowPromptLogger;
    logger?: PersonaFlowLogger;
}

export class ModelCallExecutor {
    private readonly logger: PersonaFlowLogger;

    constructor(private readonly deps: PersonaFlowModelServiceDependencies) {
        this.logger = deps.logger ?? createNoopPersonaFlowLogger();
    }

    private async resolveProviderModelRuntime(
        userId: string,
        characterId: string,
        modelCallPurpose: ModelCallPurpose): Promise<{
            provider: string;
            model: string;
            apiKey: string;
        }> {
        this.logger.verbose("persona-flow/model: resolving runtime", {
            userId: userId,
            characterId: characterId,
            modelCallPurpose,
        });
        const prefs = await this.deps.appStores.userPreferences.getUserPreferences(userId);
        const { provider, model } = prefs?.functionModels?.[modelCallPurpose] ?? {};

        // const fnModel = prefs?.functionModels?.[functionName];
        // const fnModel = await this.deps.modelSelector(
        //     this.deps.userId, this.deps.characterId, functionName as ModelCallPurpose);
        if (!provider || !model) {
            throw new Error(`${this.toFunctionLabel(modelCallPurpose)} model is not configured. Please set it in Settings -> Model Assignment.`);
        }

        // const providerConfig = this.deps.resolveProviderConfig(fnModel.provider);
        // if (!providerConfig) {
        //     throw new Error(`Configured provider "${fnModel.provider}" is not available.`);
        // }

        const credential = await this.deps.appStores.providerCredential.getCredential({
            userId: userId,
            provider: provider,
        });
        if (!credential) {
            throw new Error(`API key is not set for provider: ${provider}. userId: ${userId}`);
        }

        // const client = this.deps.createModelClient({
        //     provider: providerConfig.provider,
        //     model: fnModel.model,
        //     apiUrl: providerConfig.apiUrl,
        //     apiKey: credential.apiKeyEncrypted,
        // });

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
            apiKey: credential.apiKeyEncrypted,
        };
    }

    private toFunctionLabel(functionName: string): string {
        if (!functionName) {
            return "Function";
        }
        return functionName.charAt(0).toUpperCase() + functionName.slice(1);
    }

    private writePromptLog(
        requestId: string,
        request: PersonaChatRequest,
        model: string,
        payload: {
            status: "completed" | "failed";
            outputText: string;
            structuredOutput?: CommonRoleplayTurnOutput;
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
                functionName: request.modelCallPurpose ?? "chat",
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

    async chat(request: PersonaChatRequest): Promise<PersonaChatResponse> {
        const requestId = crypto.randomUUID();
        const llmResponseMode: LlmResponseMode = request.llmResponseMode ?? "non-structured";
        const { provider, model, apiKey } = await this.resolveProviderModelRuntime(
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
        let structuredOutput: CommonRoleplayTurnOutput | undefined;
        let toolCalls: ModelToolCall[] = [];
        let usage: ModelUsage | undefined;

        try {
            if (llmResponseMode === "structured") {
                const structuredResult = await this.deps.modelClient.generateStructured({
                    provider,
                    model,
                    apiKey,
                    messages: request.messages,
                });
                structuredOutput = structuredResult.structuredOutput;
                toolCalls = structuredResult.toolCalls;
                usage = structuredResult.usage;
                output = structuredOutput.action === "reply"
                    ? structuredOutput.replyText
                    : "";
            } else {
                const result = await this.deps.modelClient.generateNonStructured({
                    provider,
                    model,
                    apiKey,
                    messages: request.messages,
                });
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

    async chatStream(request: PersonaChatRequest & { onTextDelta?: (delta: string) => void }): Promise<PersonaChatResponse & ModelStreamResult> {
        const requestId = crypto.randomUUID();
        const mode: LlmResponseMode = request.llmResponseMode ?? "non-structured";
        const functionName = request.modelCallPurpose ?? "chat";
        const { provider, model, apiKey } = await this.resolveProviderModelRuntime(
            request.userId,
            request.characterId,
            functionName as ModelCallPurpose,
        );

        if (mode !== "non-structured") {
            this.logger.warn("persona-flow/model: chatStream called with unsupported mode", {
                requestId,
                mode,
                functionName,
            });
            throw new Error("PersonaFlow chatStream currently supports only non-structured mode.");
        }

        this.logger.verbose("persona-flow/model: chatStream request", {
            requestId,
            mode,
            functionName,
            messages: request.messages,
        });

        let streamResult: ModelStreamResult | undefined;
        let streamError: string | undefined;

        try {
            streamResult = await this.deps.modelClient.generateNonStructuredStream(
                {
                    provider,
                    model,
                    apiKey,
                    messages: request.messages,
                },
                {
                    onTextDelta: request.onTextDelta,
                    onToolCall: (toolCall) => {
                        this.logger.debug("persona-flow/model: stream tool call requested (TODO)", {
                            requestId,
                            functionName,
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
                functionName,
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
                functionName,
            });
            throw new Error("PersonaFlow chatStream ended without a stream result.");
        }

        this.logger.verbose("persona-flow/model: chatStream completed", {
            requestId,
            mode,
            functionName,
            outputLength: streamResult.output.length,
            toolCallCount: streamResult.toolCalls.length,
            usage: streamResult.usage,
            streamCompleted: streamResult.completed,
            finishReason: streamResult.finishReason,
        });

        if (!streamResult.completed) {
            this.logger.warn("persona-flow/model: stream ended without completion marker", {
                requestId,
                functionName,
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
