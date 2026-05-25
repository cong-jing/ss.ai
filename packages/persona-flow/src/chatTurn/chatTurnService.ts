import type { InteractionMode, LlmResponseMode } from "@ss-ai/contracts";
import type { AppStores } from "../stores/appStores.js";
import { prepareChatTurnContext } from "./chatTurnPreparation.js";
import { createNoopPersonaFlowLogger, type PersonaFlowLogger, type PersonaFlowPromptLogger } from "./personaFlowLogger.js";
import type { ModelClient } from "../llm/modelClient.js";
import { resolveModelCall } from "../modelCall/modelCallRegistry.js";
import { ModelRuntime } from "../modelCall/modelRuntime.js";

export interface PersonaFlowChatTurnServiceDependencies {
    stores: AppStores;
    logger?: PersonaFlowLogger;
    promptLogger: PersonaFlowPromptLogger;
    modelClient: ModelClient;
}

export interface PersonaChatTurnRequest {
    userId: string;
    characterId: string;
    conversationId: string;
    userMessageText: string;
    llmResponseMode: LlmResponseMode;
    interactionMode?: InteractionMode;
    senderActorId?: unknown;
    includeAssembledMessages?: boolean;
}

export interface PersonaDryRunTurnRequest {
    userId: string;
    characterId: string;
    conversationId: string;
    userMessageText: string;
    llmResponseMode: LlmResponseMode;
    interactionMode?: InteractionMode;
    senderActorId?: unknown;
}

export interface PersonaStreamTurnRequest {
    userId: string;
    characterId: string;
    conversationId: string;
    userMessageText: string;
    llmResponseMode: "non-structured";
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
        });
    }

    async dryRunTurn(input: PersonaDryRunTurnRequest): Promise<{ messages: Array<{ role: "system" | "user" | "assistant"; content: string }> }> {
        this.logger.debug("persona-flow/chat-turn: dry-run requested", {
            userId: input.userId,
            characterId: input.characterId,
            conversationId: input.conversationId,
            llmResponseMode: input.llmResponseMode,
            interactionMode: input.interactionMode,
        });

        const prepared = await prepareChatTurnContext({
            stores: this.deps.stores,
            userId: input.userId,
            characterId: input.characterId,
            conversationId: input.conversationId,
            userMessageText: input.userMessageText,
            llmResponseMode: input.llmResponseMode,
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
            llmResponseMode: input.llmResponseMode,
            interactionMode: input.interactionMode,
            dryRun: true,
        });

        this.logger.verbose("persona-flow/chat-turn: dry-run prepared", {
            conversationId: input.conversationId,
            renderedMessageCount: dryRunResult.prepared.messages.length,
        });

        return { messages: dryRunResult.prepared.messages };
    }

    async chatTurn(input: PersonaChatTurnRequest): Promise<{
        requestId: string;
        model: string;
        output: string;
        userMessageId: string;
        assistantMessageId?: string;
        structuredOutput?: unknown;
        assembledMessages?: Array<{ role: "system" | "user" | "assistant"; content: string }>;
    }> {
        this.logger.debug("persona-flow/chat-turn: chat requested", {
            userId: input.userId,
            characterId: input.characterId,
            conversationId: input.conversationId,
            llmResponseMode: input.llmResponseMode,
            interactionMode: input.interactionMode,
        });

        if (input.llmResponseMode !== "structured") {
            // TODO: decide whether chat.main/singleCharacterChat should support non-structured mode.
            this.logger.warn("persona-flow/chat-turn: non-structured chat requested; using structured model call", {
                conversationId: input.conversationId,
                requestedMode: input.llmResponseMode,
            });
        }

        const prepared = await prepareChatTurnContext({
            stores: this.deps.stores,
            userId: input.userId,
            characterId: input.characterId,
            conversationId: input.conversationId,
            userMessageText: input.userMessageText,
            llmResponseMode: input.llmResponseMode,
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
            llmResponseMode: input.llmResponseMode,
            interactionMode: input.interactionMode,
        });
        if (!callResult.response || !callResult.turnResult) {
            throw new Error("Model call must return response and turnResult for chat turn.");
        }
        if (callResult.turnResult.kind === "noReply") {
            this.logger.debug("persona-flow/chat-turn: assistant message not appended", {
                requestId: callResult.response.requestId,
                conversationId: input.conversationId,
                reason: callResult.turnResult.reason,
            });
            return {
                requestId: callResult.response.requestId,
                model: callResult.response.model,
                output: "",
                userMessageId: prepared.userMessage.id,
                structuredOutput: callResult.turnResult.structuredOutput,
                ...(input.includeAssembledMessages ? { assembledMessages: callResult.prepared.messages } : {}),
            };
        }
        if (callResult.turnResult.kind !== "assistantReply") {
            throw new Error(`Unsupported turn result kind for chat.main: ${callResult.turnResult.kind}`);
        }
        const normalizedAssistantOutput = callResult.turnResult.text;

        const assistantMessageId = crypto.randomUUID();
        await this.deps.stores.chat.appendMessage({
            id: assistantMessageId,
            conversationId: input.conversationId,
            senderActorId: prepared.selfActorId,
            content: normalizedAssistantOutput,
            createdAt: new Date().toISOString(),
        });

        this.logger.verbose("persona-flow/chat-turn: assistant message appended", {
            requestId: callResult.response.requestId,
            conversationId: input.conversationId,
            assistantMessageId,
        });

        return {
            requestId: callResult.response.requestId,
            model: callResult.response.model,
            output: normalizedAssistantOutput,
            userMessageId: prepared.userMessage.id,
            assistantMessageId,
            structuredOutput: callResult.turnResult.structuredOutput,
            ...(input.includeAssembledMessages ? { assembledMessages: callResult.prepared.messages } : {}),
        };
    }

    async streamTurn(input: PersonaStreamTurnRequest): Promise<{
        requestId: string;
        model: string;
        output: string;
        userMessageId: string;
        assistantMessageId: string;
        assembledMessages?: Array<{ role: "system" | "user" | "assistant"; content: string }>;
        streamCompleted: boolean;
        streamFinishReason?: string;
    }> {
        this.logger.debug("persona-flow/chat-turn: stream requested", {
            userId: input.userId,
            characterId: input.characterId,
            conversationId: input.conversationId,
            llmResponseMode: input.llmResponseMode,
            interactionMode: input.interactionMode,
        });

        // TODO: decide whether chat.main/singleCharacterChat supports streaming.
        // For now stream requests use the structured model call and emit the full reply once.
        const prepared = await prepareChatTurnContext({
            stores: this.deps.stores,
            userId: input.userId,
            characterId: input.characterId,
            conversationId: input.conversationId,
            userMessageText: input.userMessageText,
            llmResponseMode: input.llmResponseMode,
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
            llmResponseMode: input.llmResponseMode,
            interactionMode: input.interactionMode,
        });
        if (!callResult.response || !callResult.turnResult) {
            throw new Error("Model call must return response and turnResult for stream turn.");
        }
        if (input.includeAssembledMessages) {
            input.onAssembledMessages?.(callResult.prepared.messages);
        }
        if (callResult.turnResult.kind !== "assistantReply") {
            throw new Error(`Unsupported stream turn result kind for chat.main: ${callResult.turnResult.kind}`);
        }
        const fullResponse = callResult.turnResult.text;
        input.onChunk?.(fullResponse);

        const assistantMessageId = crypto.randomUUID();
        await this.deps.stores.chat.appendMessage({
            id: assistantMessageId,
            conversationId: input.conversationId,
            senderActorId: prepared.selfActorId,
            content: fullResponse,
            createdAt: new Date().toISOString(),
        });

        this.logger.verbose("persona-flow/chat-turn: structured fallback assistant message appended for stream request", {
            requestId: callResult.response.requestId,
            conversationId: input.conversationId,
            assistantMessageId,
        });

        return {
            requestId: callResult.response.requestId,
            model: callResult.response.model,
            output: fullResponse,
            userMessageId: prepared.userMessage.id,
            assistantMessageId,
            ...(input.includeAssembledMessages ? { assembledMessages: callResult.prepared.messages } : {}),
            streamCompleted: true,
        };
    }

}
