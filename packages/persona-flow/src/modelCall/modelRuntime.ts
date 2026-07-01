import type { RenderedMessage } from "../prompt/promptTypes.js";
import type {
    ModelClient,
    StructuredOutputSchema,
    ModelToolCall,
    ModelToolCallDelta,
    ModelUsage,
    ModelStreamResult,
} from "../llm/modelClient.js";
import type { ModelToolChoice, ModelToolDefinition } from "../llm/tools/modelTool.js";
import { createNoopPersonaFlowLogger, type PersonaFlowLogger, type PersonaFlowPromptLogger } from "../chatTurn/personaFlowLogger.js";
import type { ModelAssignmentMap, ModelCallPurpose } from "@ss-ai/contracts";
import type { AppStores } from "../stores/appStores.js";
import { toJSONSchema } from "zod";

export interface PersonaModelRequest {
    userId: string;
    characterId: string;
    messages: RenderedMessage[];
    modelCallPurpose: ModelCallPurpose;
    structuredOutputSchema?: StructuredOutputSchema;
    tools?: ModelToolDefinition[];
    toolChoice?: ModelToolChoice;
}

export interface PersonaModelResponse {
    output: string;
    model: string;
    requestId: string;
    apiKeySource: "user" | "default";
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
    defaultModelAssignments?: ModelAssignmentMap;
    defaultProviderApiKeys?: Record<string, string>;
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
            apiKeySource: "user" | "default";
        }> {
        this.logger.verbose("persona-flow/model: resolving runtime", {
            userId: userId,
            characterId: characterId,
            modelCallPurpose,
        });
        const prefs = await this.deps.appStores.userPreferences.getUserPreferences(userId);
        // `memory.consolidate` is a system-only purpose with no settings UI yet,
        // so it transparently falls back to the `memory.summarize` assignment
        // until a dedicated assignment / UI ships. The purpose identity itself
        // stays distinct everywhere else (audit, prompt log) so the two calls
        // remain separable.
        const fallbackPurpose: ModelCallPurpose | undefined =
            modelCallPurpose === "memory.consolidate" ? "memory.summarize" : undefined;
        const userAssignment = prefs?.modelAssignments?.[modelCallPurpose]
            ?? (fallbackPurpose ? prefs?.modelAssignments?.[fallbackPurpose] : undefined);
        const defaultAssignment = this.deps.defaultModelAssignments?.[modelCallPurpose]
            ?? (fallbackPurpose ? this.deps.defaultModelAssignments?.[fallbackPurpose] : undefined);
        const { provider, model } = userAssignment ?? defaultAssignment ?? {};

        if (!provider || !model) {
            throw new Error(`${this.toPurposeLabel(modelCallPurpose)} model is not configured. Please set it in Settings -> Model Assignment.`);
        }

        const credential = await this.deps.appStores.providerCredential.getCredential({
            userId: userId,
            provider: provider,
        });
        const fallbackApiKey = this.deps.defaultProviderApiKeys?.[provider.toLowerCase()]?.trim() ?? "";
        const encryptedApiKey = credential?.encryptedApiKey ?? fallbackApiKey;
        if (!encryptedApiKey) {
            throw new Error(`API key is not set for provider: ${provider}. userId: ${userId}`);
        }
        const apiKeySource = credential?.encryptedApiKey ? "user" : "default";

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
            encryptedApiKey,
            apiKeySource,
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
                outputMode: request.structuredOutputSchema ? "structured" : "text_or_tools",
                modelCallPurpose: request.modelCallPurpose ?? "chat.main",
                tools: request.tools?.map(tool => ({
                    kind: tool.kind,
                    name: tool.name,
                    terminal: tool.terminal,
                    purpose: tool.purpose,
                    argsSchema: toJSONSchema(tool.argsSchema, { io: "input" }),
                })),
                toolChoice: request.toolChoice,
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
        const isStructuredResponse = Boolean(request.structuredOutputSchema);
        const { provider, model, encryptedApiKey, apiKeySource } = await this.resolveProviderModelRuntime(
            request.userId,
            request.characterId,
            request.modelCallPurpose,
        );

        this.logger.verbose("persona-flow/model: chat request", {
            requestId,
            outputMode: isStructuredResponse ? "structured" : "text_or_tools",
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
                structuredOutputSchema: isStructuredResponse ? request.structuredOutputSchema : undefined,
                tools: request.tools,
                toolChoice: request.toolChoice,
            });

            if (isStructuredResponse) {
                if (!("structuredOutput" in result)) {
                    throw new Error("Model client returned non-structured result for structured request.");
                }

                structuredOutput = result.structuredOutput;
                toolCalls = result.toolCalls;
                usage = result.usage;
                // For structured responses, the canonical business result lives in
                // `structuredOutput`. We deliberately do not synthesize a display
                // string from it here — the model-call layer owns shaping any
                // user-facing text from its specific structured payload.
                output = "";
            } else {
                if (!("output" in result)) {
                    throw new Error("Model client returned structured result for non-structured request.");
                }

                output = result.output ?? "";
                toolCalls = result.toolCalls;
                usage = result.usage;
            }
        } catch (err: unknown) {
            const errorMessage = err instanceof Error ? err.message : "Unknown error";
            this.logger.error("persona-flow/model: chat failed", {
                requestId,
                outputMode: isStructuredResponse ? "structured" : "text_or_tools",
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
            outputMode: isStructuredResponse ? "structured" : "text_or_tools",
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
            apiKeySource,
            toolCalls,
            usage,
            ...(structuredOutput ? { structuredOutput } : {}),
        };
    }

    async chatStream(request: PersonaModelRequest & {
        onTextDelta?: (delta: string) => void;
        onToolCallDelta?: (delta: ModelToolCallDelta) => void;
    }): Promise<PersonaModelResponse & ModelStreamResult> {
        const requestId = crypto.randomUUID();
        const modelCallPurpose = request.modelCallPurpose ?? "chat.main";
        const { provider, model, encryptedApiKey, apiKeySource } = await this.resolveProviderModelRuntime(
            request.userId,
            request.characterId,
            modelCallPurpose as ModelCallPurpose,
        );

        this.logger.verbose("persona-flow/model: chatStream request", {
            requestId,
            modelCallPurpose,
            messages: request.messages,
        });

        let streamResult: ModelStreamResult | undefined;
        let streamError: string | undefined;

        try {
            streamResult = await this.deps.modelClient.generateStream(
                {
                    provider,
                    model,
                    encryptedApiKey,
                    messages: request.messages,
                    structuredOutputSchema: request.structuredOutputSchema,
                    tools: request.tools,
                    toolChoice: request.toolChoice,
                },
                {
                    onTextDelta: request.onTextDelta,
                    onToolCallDelta: request.onToolCallDelta,
                    onToolCall: (toolCall) => {
                        this.logger.debug("persona-flow/model: stream tool call completed", {
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
                modelCallPurpose,
                error: streamError,
            });
            throw err;
        } finally {
            this.writePromptLog(requestId, request, model, {
                status: streamError ? "failed" : "completed",
                outputText: streamResult?.output ?? "",
                structuredOutput: streamResult?.structuredOutput,
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
                modelCallPurpose,
            });
            throw new Error("PersonaFlow chatStream ended without a stream result.");
        }

        this.logger.verbose("persona-flow/model: chatStream completed", {
            requestId,
            modelCallPurpose,
            outputLength: streamResult.output?.length ?? 0,
            hasStructuredOutput: streamResult.structuredOutput !== undefined,
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
            output: streamResult.output ?? "",
            model: model,
            requestId,
            apiKeySource,
            toolCalls: streamResult.toolCalls,
            usage: streamResult.usage,
            completed: streamResult.completed,
            finishReason: streamResult.finishReason,
            streamCompleted: streamResult.completed,
            streamFinishReason: streamResult.finishReason,
            ...(streamResult.structuredOutput !== undefined
                ? { structuredOutput: streamResult.structuredOutput }
                : {}),
        };
    }
}
