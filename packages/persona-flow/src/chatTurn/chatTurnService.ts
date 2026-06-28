import type { InteractionMode, ModelAssignmentMap, ModelCallPurpose, TurnEvent } from "@ss-ai/contracts";
import type { AppStores } from "../stores/appStores.js";
import { prepareChatTurnContext } from "./chatTurnPreparation.js";
import { createNoopPersonaFlowLogger, type PersonaFlowLogger, type PersonaFlowPromptLogger } from "./personaFlowLogger.js";
import { logMemoryWriteCandidates } from "./memoryCandidateLogger.js";
import type { ModelClient } from "../llm/modelClient.js";
import type { SingleCharacterChatResult } from "../modelCall/chat.main/singleCharacterChat/singleCharacterChatCall.js";
import type { ModelCallRunResult } from "../modelCall/modelCall.js";
import { resolveModelCall } from "../modelCall/modelCallRegistry.js";
import { ModelRuntime } from "../modelCall/modelRuntime.js";
import type { SubmitTurnEventsTurnEventPreview } from "./events/submitTurnEventsStreamPreview.js";
import { createMemoryPipelineService } from "../memory/index.js";
import type {
    MemoryPipelineService,
    MemoryPipelineSettings,
} from "../memory/index.js";

export interface PersonaFlowChatTurnServiceDependencies {
    stores: AppStores;
    logger?: PersonaFlowLogger;
    promptLogger: PersonaFlowPromptLogger;
    modelClient: ModelClient;
    defaultModelAssignments?: ModelAssignmentMap;
    defaultProviderApiKeys?: Record<string, string>;
    /**
     * Runtime settings for the memory pipeline. Required so this
     * service can construct its own {@link MemoryPipelineService}
     * (via {@link createMemoryPipelineService}) when one is not
     * supplied. Tests typically pass `DEFAULT_MEMORY_PIPELINE_SETTINGS`
     * (or override individual fields for record-only / disabled
     * scenarios); production wiring forwards the value derived from
     * the runtime config.
     */
    memoryPipelineSettings: MemoryPipelineSettings;
    /**
     * Pre-built memory pipeline. Tests that want to inject in-memory
     * stores or fake processors supply one directly; production
     * wiring may either reuse a shared instance or let this service
     * build its own from `stores` + `modelClient` via the factory.
     */
    memoryPipelineService?: MemoryPipelineService;
}

export interface PersonaChatTurnRequest {
    userId: string;
    characterId: string;
    conversationId: string;
    userMessageText: string;
    interactionMode?: InteractionMode;
    senderActorId?: unknown;
    includeAssembledMessages?: boolean;
}

export interface PersonaDryRunTurnRequest {
    userId: string;
    characterId: string;
    conversationId: string;
    userMessageText: string;
    interactionMode?: InteractionMode;
    senderActorId?: unknown;
}

export interface PersonaStreamTurnRequest {
    userId: string;
    characterId: string;
    conversationId: string;
    userMessageText: string;
    interactionMode?: InteractionMode;
    senderActorId?: unknown;
    includeAssembledMessages?: boolean;
    onAssembledMessages?: (messages: Array<{ role: "system" | "user" | "assistant"; content: string }>) => void;
    onChunk?: (chunk: string) => void;
    /**
     * Called when the model call surfaces a complete-but-not-yet-final
     * `turnEventPreview`. Consumers (web UI, bots) may use these to update
     * speculative state (expression, atmosphere) and reconcile against the
     * authoritative `turnEvents` returned in the final result.
     */
    onTurnEventPreview?: (preview: SubmitTurnEventsTurnEventPreview) => void;
}

export class PersonaFlowChatTurnService {
    private readonly logger: PersonaFlowLogger;
    private readonly modelRuntime: ModelRuntime;
    private readonly memoryPipelineService: MemoryPipelineService;

    constructor(private readonly deps: PersonaFlowChatTurnServiceDependencies) {
        this.logger = deps.logger ?? createNoopPersonaFlowLogger();
        this.modelRuntime = new ModelRuntime({
            modelClient: deps.modelClient,
            appStores: deps.stores,
            logger: this.logger,
            promptLogger: deps.promptLogger,
            defaultModelAssignments: deps.defaultModelAssignments,
            defaultProviderApiKeys: deps.defaultProviderApiKeys,
        });
        this.memoryPipelineService = deps.memoryPipelineService ?? createMemoryPipelineService({
            stores: deps.stores,
            modelClient: deps.modelClient,
            settings: deps.memoryPipelineSettings,
            ...(deps.defaultModelAssignments ? { defaultModelAssignments: deps.defaultModelAssignments } : {}),
            ...(deps.defaultProviderApiKeys ? { defaultProviderApiKeys: deps.defaultProviderApiKeys } : {}),
            logger: this.logger,
        });
    }

    async dryRunTurn(input: PersonaDryRunTurnRequest): Promise<{ messages: Array<{ role: "system" | "user" | "assistant"; content: string }> }> {
        this.logger.debug("persona-flow/chat-turn: dry-run requested", {
            userId: input.userId,
            characterId: input.characterId,
            conversationId: input.conversationId,
            interactionMode: input.interactionMode,
        });

        const prepared = await prepareChatTurnContext({
            stores: this.deps.stores,
            userId: input.userId,
            characterId: input.characterId,
            conversationId: input.conversationId,
            userMessageText: input.userMessageText,
            interactionMode: input.interactionMode,
            senderActorId: input.senderActorId,
            persistUserMessage: false,
            logger: this.logger,
        });
        const modelCall = resolveModelCall({
            purpose: "chat.main",
            interactionMode: input.interactionMode,
        });
        const dryRunResult = await modelCall.run({
            runtime: this.modelRuntime,
            userId: input.userId,
            characterId: input.characterId,
            promptContext: prepared.promptContext,
            interactionMode: input.interactionMode,
            dryRun: true,
        });

        this.logger.verbose("persona-flow/chat-turn: dry-run prepared", {
            conversationId: input.conversationId,
            renderedMessageCount: dryRunResult.llmRequestSnapshot.messages.length,
        });

        return { messages: dryRunResult.llmRequestSnapshot.messages };
    }

    async chatTurn(input: PersonaChatTurnRequest): Promise<{
        requestId: string;
        model: string;
        apiKeySource: "user" | "default";
        output: string;
        userMessageId: string;
        assistantMessageId?: string;
        turnEvents?: TurnEvent[];
        assembledMessages?: Array<{ role: "system" | "user" | "assistant"; content: string }>;
    }> {
        this.logger.debug("persona-flow/chat-turn: chat requested", {
            userId: input.userId,
            characterId: input.characterId,
            conversationId: input.conversationId,
            interactionMode: input.interactionMode,
        });

        const prepared = await prepareChatTurnContext({
            stores: this.deps.stores,
            userId: input.userId,
            characterId: input.characterId,
            conversationId: input.conversationId,
            userMessageText: input.userMessageText,
            interactionMode: input.interactionMode,
            senderActorId: input.senderActorId,
            persistUserMessage: true,
            logger: this.logger,
        });
        const modelCall = resolveModelCall({
            purpose: "chat.main",
            interactionMode: input.interactionMode,
        });
        const callResult = await modelCall.run({
            runtime: this.modelRuntime,
            userId: input.userId,
            characterId: input.characterId,
            promptContext: prepared.promptContext,
            interactionMode: input.interactionMode,
        });
        if (!callResult.llmResponse) {
            throw new Error("Model call must return llmResponse for chat turn.");
        }
        const chatResult = getSingleCharacterChatResult(callResult);
        const normalizedAssistantOutput = chatResult.displayText;
        const turnEvents = chatResult.events;

        // Assistant turns are persisted even when no replyText event produced visible text.
        // UI and bot integrations can then skip rendering/sending the empty text while
        // still retaining non-text turn events such as expression or state updates.
        const assistantMessageId = crypto.randomUUID();
        await this.deps.stores.chat.appendAssistantTurn({
            message: {
                id: assistantMessageId,
                conversationId: input.conversationId,
                senderActorId: prepared.selfActorId,
                kind: "assistant_turn_events",
                displayText: normalizedAssistantOutput,
                createdAt: new Date().toISOString(),
            },
            events: turnEvents,
        });

        this.logger.verbose("persona-flow/chat-turn: assistant message appended", {
            requestId: callResult.llmResponse.requestId,
            conversationId: input.conversationId,
            assistantMessageId,
        });

        await this.safeHandleMemoryWriteCandidates({
            requestId: callResult.llmResponse.requestId,
            userId: input.userId,
            characterId: input.characterId,
            conversationId: input.conversationId,
            userMessageId: prepared.userMessage.id,
            assistantMessageId,
            modelCallPurpose: "chat.main",
            candidates: chatResult.memoryWriteCandidates,
        });

        return {
            requestId: callResult.llmResponse.requestId,
            model: callResult.llmResponse.model,
            apiKeySource: callResult.llmResponse.apiKeySource,
            output: normalizedAssistantOutput,
            userMessageId: prepared.userMessage.id,
            assistantMessageId,
            turnEvents,
            ...(input.includeAssembledMessages ? { assembledMessages: callResult.llmRequestSnapshot.messages } : {}),
        };
    }

    async streamTurn(input: PersonaStreamTurnRequest): Promise<{
        requestId: string;
        model: string;
        apiKeySource: "user" | "default";
        output: string;
        userMessageId: string;
        assistantMessageId: string;
        turnEvents?: TurnEvent[];
        assembledMessages?: Array<{ role: "system" | "user" | "assistant"; content: string }>;
        streamCompleted: boolean;
        streamFinishReason?: string;
    }> {
        this.logger.debug("persona-flow/chat-turn: stream requested", {
            userId: input.userId,
            characterId: input.characterId,
            conversationId: input.conversationId,
            interactionMode: input.interactionMode,
        });

        const prepared = await prepareChatTurnContext({
            stores: this.deps.stores,
            userId: input.userId,
            characterId: input.characterId,
            conversationId: input.conversationId,
            userMessageText: input.userMessageText,
            interactionMode: input.interactionMode,
            senderActorId: input.senderActorId,
            persistUserMessage: true,
            logger: this.logger,
        });
        const modelCall = resolveModelCall({
            purpose: "chat.main",
            interactionMode: input.interactionMode,
        });

        const runStreamInput = {
            runtime: this.modelRuntime,
            userId: input.userId,
            characterId: input.characterId,
            promptContext: prepared.promptContext,
            interactionMode: input.interactionMode,
            onDisplayTextDelta: input.onChunk,
            onTurnEventPreview: input.onTurnEventPreview,
        };

        // Build assembled messages preview before calling the model so debug
        // consumers can inspect the prompt while the model is still streaming.
        let assembledEmitted = false;
        const emitAssembledOnce = (
            messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
        ) => {
            if (assembledEmitted) return;
            assembledEmitted = true;
            if (input.includeAssembledMessages) {
                input.onAssembledMessages?.(messages);
            }
        };

        let callResult: ModelCallRunResult;
        if (typeof modelCall.runStream === "function") {
            // Dry-run the prompt once first so we can emit assembled messages
            // before the actual stream call begins. The model call's stream
            // path itself does not currently surface its assembled request
            // until it returns.
            if (input.includeAssembledMessages) {
                const previewResult = await modelCall.run({
                    runtime: this.modelRuntime,
                    userId: input.userId,
                    characterId: input.characterId,
                    promptContext: prepared.promptContext,
                    interactionMode: input.interactionMode,
                    dryRun: true,
                });
                emitAssembledOnce(previewResult.llmRequestSnapshot.messages);
            }
            callResult = await modelCall.runStream(runStreamInput);
        } else {
            this.logger.warn(
                "persona-flow/chat-turn: model call has no runStream; falling back to non-stream run()",
                { purpose: modelCall.purpose },
            );
            callResult = await modelCall.run(runStreamInput);
            if (input.includeAssembledMessages) {
                emitAssembledOnce(callResult.llmRequestSnapshot.messages);
            }
            const chatResultFallback = getSingleCharacterChatResult(callResult);
            input.onChunk?.(chatResultFallback.displayText);
        }

        if (!callResult.llmResponse) {
            throw new Error("Model call must return llmResponse for stream turn.");
        }
        // Ensure assembled messages are emitted at least once when requested,
        // even when the runStream path didn't get a chance to call it earlier.
        if (input.includeAssembledMessages) {
            emitAssembledOnce(callResult.llmRequestSnapshot.messages);
        }
        const chatResult = getSingleCharacterChatResult(callResult);
        const fullResponse = chatResult.displayText;
        const turnEvents = chatResult.events;

        const assistantMessageId = crypto.randomUUID();
        await this.deps.stores.chat.appendAssistantTurn({
            message: {
                id: assistantMessageId,
                conversationId: input.conversationId,
                senderActorId: prepared.selfActorId,
                kind: "assistant_turn_events",
                displayText: fullResponse,
                createdAt: new Date().toISOString(),
            },
            events: turnEvents,
        });

        this.logger.verbose("persona-flow/chat-turn: assistant message appended for stream request", {
            requestId: callResult.llmResponse.requestId,
            conversationId: input.conversationId,
            assistantMessageId,
        });

        await this.safeHandleMemoryWriteCandidates({
            requestId: callResult.llmResponse.requestId,
            userId: input.userId,
            characterId: input.characterId,
            conversationId: input.conversationId,
            userMessageId: prepared.userMessage.id,
            assistantMessageId,
            modelCallPurpose: "chat.main",
            candidates: chatResult.memoryWriteCandidates,
        });

        return {
            requestId: callResult.llmResponse.requestId,
            model: callResult.llmResponse.model,
            apiKeySource: callResult.llmResponse.apiKeySource,
            output: fullResponse,
            userMessageId: prepared.userMessage.id,
            assistantMessageId,
            turnEvents,
            ...(input.includeAssembledMessages ? { assembledMessages: callResult.llmRequestSnapshot.messages } : {}),
            streamCompleted: callResult.llmResponse.streamCompleted ?? true,
            ...(callResult.llmResponse.streamFinishReason
                ? { streamFinishReason: callResult.llmResponse.streamFinishReason }
                : {}),
        };
    }

    private async safeHandleMemoryWriteCandidates(input: {
        requestId: string;
        userId: string;
        characterId: string;
        conversationId: string;
        userMessageId: string;
        assistantMessageId: string;
        modelCallPurpose: ModelCallPurpose;
        candidates: SingleCharacterChatResult["memoryWriteCandidates"];
    }): Promise<void> {
        // The whole memory pipeline is fail-soft by design: it must never
        // roll back the persisted assistant turn or surface as a chat error.
        // We keep the Batch 1 INFO summary line as the primary observability
        // sink (so dashboards / log queries still see "candidates logged"
        // even when storage is disabled or fails), then hand off to the
        // pipeline service which owns the rest of the policy
        // (enabled/disabled, record-only vs inline, recorder + processor).
        try {
            logMemoryWriteCandidates(this.logger, input);
        } catch (err) {
            this.logger.warn("persona-flow/memory: candidate logging failed", {
                requestId: input.requestId,
                conversationId: input.conversationId,
                error: err instanceof Error ? err.message : String(err),
            });
        }

        try {
            await this.memoryPipelineService.handleChatTurnCandidates({
                source: {
                    userId: input.userId,
                    characterId: input.characterId,
                    conversationId: input.conversationId,
                    userMessageId: input.userMessageId,
                    assistantMessageId: input.assistantMessageId,
                    requestId: input.requestId,
                    modelCallPurpose: input.modelCallPurpose,
                },
                candidates: input.candidates,
            });
        } catch (err) {
            // The pipeline service is documented to fail-soft and never
            // throw on normal failures; this catch only fires on
            // programmer bugs that escape its internal handling.
            this.logger.warn("persona-flow/memory: pipeline service failed", {
                requestId: input.requestId,
                conversationId: input.conversationId,
                error: err instanceof Error ? err.message : String(err),
            });
        }
    }

}

function getSingleCharacterChatResult(callResult: ModelCallRunResult): SingleCharacterChatResult {
    const parsedOutput = callResult.parsedOutput;
    if (
        !parsedOutput
        || typeof parsedOutput !== "object"
        || typeof (parsedOutput as SingleCharacterChatResult).displayText !== "string"
        || !Array.isArray((parsedOutput as SingleCharacterChatResult).events)
        || !Array.isArray((parsedOutput as SingleCharacterChatResult).memoryWriteCandidates)
    ) {
        throw new Error("Model call must return a parsed single-character chat result.");
    }
    return parsedOutput as SingleCharacterChatResult;
}
