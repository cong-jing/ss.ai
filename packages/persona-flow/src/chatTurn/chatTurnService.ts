import type { InteractionMode, ModelAssignmentMap, TurnEvent } from "@ss-ai/contracts";
import type { AppStores } from "../stores/appStores.js";
import { prepareChatTurnContext } from "./chatTurnPreparation.js";
import { createNoopPersonaFlowLogger, type PersonaFlowLogger, type PersonaFlowPromptLogger } from "./personaFlowLogger.js";
import type { ModelClient } from "../llm/modelClient.js";
import type { SingleCharacterChatResult } from "../modelCall/chat.main/singleCharacterChat/singleCharacterChatCall.js";
import type { ModelCallRunResult } from "../modelCall/modelCall.js";
import { resolveModelCall } from "../modelCall/modelCallRegistry.js";
import { ModelRuntime } from "../modelCall/modelRuntime.js";

export interface PersonaFlowChatTurnServiceDependencies {
    stores: AppStores;
    logger?: PersonaFlowLogger;
    promptLogger: PersonaFlowPromptLogger;
    modelClient: ModelClient;
    defaultModelAssignments?: ModelAssignmentMap;
    defaultProviderApiKeys?: Record<string, string>;
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
}

export class PersonaFlowChatTurnService {
    private readonly logger: PersonaFlowLogger;
    private readonly modelRuntime: ModelRuntime;

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

        // TODO: implement true turn-event streaming for chat.main/singleCharacterChat.
        // For now stream requests use the terminal tool call and emit the full reply once.
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
            throw new Error("Model call must return llmResponse for stream turn.");
        }
        if (input.includeAssembledMessages) {
            input.onAssembledMessages?.(callResult.llmRequestSnapshot.messages);
        }
        const chatResult = getSingleCharacterChatResult(callResult);
        const fullResponse = chatResult.displayText;
        const turnEvents = chatResult.events;
        input.onChunk?.(fullResponse);

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

        this.logger.verbose("persona-flow/chat-turn: structured fallback assistant message appended for stream request", {
            requestId: callResult.llmResponse.requestId,
            conversationId: input.conversationId,
            assistantMessageId,
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
            streamCompleted: true,
        };
    }

}

function getSingleCharacterChatResult(callResult: ModelCallRunResult): SingleCharacterChatResult {
    const parsedOutput = callResult.parsedOutput;
    if (
        !parsedOutput
        || typeof parsedOutput !== "object"
        || typeof (parsedOutput as SingleCharacterChatResult).displayText !== "string"
        || !Array.isArray((parsedOutput as SingleCharacterChatResult).events)
    ) {
        throw new Error("Model call must return a parsed single-character chat result.");
    }
    return parsedOutput as SingleCharacterChatResult;
}
