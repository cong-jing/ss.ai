import type { CommonRoleplayTurnOutput } from "../structuredOutput/commonRoleplayTurnOutput.js";
import type { RenderedMessage } from "../prompt/system/systemPromptBuilder.js";
import type { UserPreferencesStore } from "../stores/user/userPreferencesStore.js";
import type { UserProviderCredentialStore } from "../stores/user/userProviderCredentialStore.js";
import type {
    GenerationMode,
    ModelClient,
    ModelClientFactory,
    ModelToolCall,
    ModelUsage,
    ModelStreamResult,
} from "../llm/modelClient.js";
import { createNoopPersonaFlowLogger, type PersonaFlowLogger } from "./personaFlowLogger.js";

export interface PersonaChatRequest {
    messages: RenderedMessage[];
    mode?: GenerationMode;
    functionName?: string;
}

export interface PersonaChatResponse {
    output: string;
    model: string;
    requestId: string;
    mode: GenerationMode;
    structuredOutput?: CommonRoleplayTurnOutput;
    toolCalls: ModelToolCall[];
    usage?: ModelUsage;
    streamCompleted?: boolean;
    streamFinishReason?: string;
}

export interface PersonaPromptLogEntry {
    timestamp: string;
    requestId: string;
    model: string;
    messages: RenderedMessage[];
    output: string;
}

export interface PersonaFlowModelServiceDependencies {
    userId: string;
    userPreferencesStore: UserPreferencesStore;
    providerCredentialStore: UserProviderCredentialStore;
    resolveProviderConfig: (provider: string) => { provider: string; apiUrl: string } | null;
    createModelClient: ModelClientFactory;
    timeoutMs: number;
    maxRetries?: number;
    onPromptLog?: (entry: PersonaPromptLogEntry) => void;
    logger?: PersonaFlowLogger;
}

export class PersonaFlowModelService {
    private readonly logger: PersonaFlowLogger;

    constructor(private readonly deps: PersonaFlowModelServiceDependencies) {
        this.logger = deps.logger ?? createNoopPersonaFlowLogger();
    }

    async ensureFunctionReady(functionName = "chat"): Promise<void> {
        this.logger.debug("persona-flow/model: ensure function runtime", {
            userId: this.deps.userId,
            functionName,
        });
        await this.resolveFunctionModelRuntime(functionName);
    }

    private async resolveFunctionModelRuntime(functionName: string): Promise<{
        modelName: string;
        client: ModelClient;
    }> {
        this.logger.verbose("persona-flow/model: resolving runtime", {
            userId: this.deps.userId,
            functionName,
        });
        const prefs = await this.deps.userPreferencesStore.getUserPreferences(this.deps.userId);
        const fnModel = prefs?.functionModels?.[functionName];
        if (!fnModel?.provider || !fnModel?.model) {
            throw new Error(`${this.toFunctionLabel(functionName)} model is not configured. Please set it in Settings -> Model Assignment.`);
        }

        const providerConfig = this.deps.resolveProviderConfig(fnModel.provider);
        if (!providerConfig) {
            throw new Error(`Configured provider "${fnModel.provider}" is not available.`);
        }

        const credential = await this.deps.providerCredentialStore.getCredential({
            userId: this.deps.userId,
            provider: fnModel.provider,
        });
        if (!credential) {
            throw new Error(`API key is not set for provider: ${fnModel.provider}`);
        }

        const client = this.deps.createModelClient({
            provider: providerConfig.provider,
            model: fnModel.model,
            apiUrl: providerConfig.apiUrl,
            apiKey: credential.apiKeyEncrypted,
        });

        this.logger.debug("persona-flow/model: runtime resolved", {
            userId: this.deps.userId,
            functionName,
            provider: fnModel.provider,
            model: fnModel.model,
        });

        return {
            modelName: fnModel.model,
            client,
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
        modelName: string,
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
        this.deps.onPromptLog?.({
            timestamp: new Date().toISOString(),
            requestId,
            model: modelName,
            messages: request.messages,
            output: JSON.stringify({
                mode: request.mode ?? "non-structured",
                functionName: request.functionName ?? "chat",
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
        const mode: GenerationMode = request.mode ?? "non-structured";
        const functionName = request.functionName ?? "chat";
        const { modelName, client } = await this.resolveFunctionModelRuntime(functionName);

        this.logger.verbose("persona-flow/model: chat request", {
            requestId,
            mode,
            functionName,
            messages: request.messages,
        });

        let output = "";
        let structuredOutput: CommonRoleplayTurnOutput | undefined;
        let toolCalls: ModelToolCall[] = [];
        let usage: ModelUsage | undefined;

        try {
            if (mode === "structured") {
                const structuredResult = await client.generateStructured({
                    messages: request.messages,
                    timeoutMs: this.deps.timeoutMs,
                });
                structuredOutput = structuredResult.structuredOutput;
                toolCalls = structuredResult.toolCalls;
                usage = structuredResult.usage;
                output = structuredOutput.action === "reply"
                    ? structuredOutput.replyText
                    : "";
            } else {
                const result = await client.generateNonStructured({
                    messages: request.messages,
                    timeoutMs: this.deps.timeoutMs,
                });
                output = result.output;
                toolCalls = result.toolCalls;
                usage = result.usage;
            }
        } catch (err: unknown) {
            const errorMessage = err instanceof Error ? err.message : "Unknown error";
            this.logger.error("persona-flow/model: chat failed", {
                requestId,
                mode,
                functionName,
                error: errorMessage,
            });
            this.writePromptLog(requestId, request, modelName, {
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
                functionName,
                toolCall,
            });
        }

        this.logger.verbose("persona-flow/model: chat completed", {
            requestId,
            mode,
            functionName,
            output,
            structuredOutput,
            toolCallCount: toolCalls.length,
            usage,
        });

        this.writePromptLog(requestId, request, modelName, {
            status: "completed",
            outputText: output,
            structuredOutput,
            toolCalls,
            usage,
        });

        return {
            output,
            model: modelName,
            requestId,
            mode,
            toolCalls,
            usage,
            ...(structuredOutput ? { structuredOutput } : {}),
        };
    }

    async chatStream(request: PersonaChatRequest & { onTextDelta?: (delta: string) => void }): Promise<PersonaChatResponse & ModelStreamResult> {
        const requestId = crypto.randomUUID();
        const mode: GenerationMode = request.mode ?? "non-structured";
        const functionName = request.functionName ?? "chat";
        const { modelName, client } = await this.resolveFunctionModelRuntime(functionName);

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
            streamResult = await client.generateNonStructuredStream(
                {
                    messages: request.messages,
                    timeoutMs: this.deps.timeoutMs,
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
            this.writePromptLog(requestId, request, modelName, {
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
            model: modelName,
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
}
