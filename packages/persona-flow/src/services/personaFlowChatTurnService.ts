import type { PromptRenderMode } from "../prompt/promptRenderer.js";
import type { AppStores } from "../stores/appStores.js";
import { normalizeAssistantOutput, prepareChatTurnContext } from "./chatTurnPreparation.js";
import type { PersonaChatResponse } from "./personaFlowModelService.js";

export interface PersonaFlowChatTurnServiceDependencies {
    stores: AppStores;
    getModelServiceForUser: (userId: string) => Promise<{
        chat: (request: { messages: Array<{ role: "system" | "user" | "assistant"; content: string }>; mode?: "non-structured" | "structured"; functionName?: string }) => Promise<PersonaChatResponse>;
        chatStream: (request: {
            messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
            mode?: "non-structured" | "structured";
            functionName?: string;
            onTextDelta?: (delta: string) => void;
        }) => Promise<PersonaChatResponse & {
            completed: boolean;
            finishReason?: string;
        }>;
    }>;
}

export interface PersonaChatTurnRequest {
    userId: string;
    characterId: string;
    conversationId: string;
    userMessageText: string;
    llmResponseMode: PromptRenderMode;
    senderActorId?: unknown;
    includeAssembledMessages?: boolean;
}

export interface PersonaDryRunTurnRequest {
    userId: string;
    characterId: string;
    conversationId: string;
    userMessageText: string;
    llmResponseMode: PromptRenderMode;
    senderActorId?: unknown;
}

export interface PersonaStreamTurnRequest {
    userId: string;
    characterId: string;
    conversationId: string;
    userMessageText: string;
    llmResponseMode: "non-structured";
    senderActorId?: unknown;
    includeAssembledMessages?: boolean;
    onAssembledMessages?: (messages: Array<{ role: "system" | "user" | "assistant"; content: string }>) => void;
    onChunk?: (chunk: string) => void;
}

export class PersonaFlowChatTurnService {
    constructor(private readonly deps: PersonaFlowChatTurnServiceDependencies) { }

    async dryRunTurn(input: PersonaDryRunTurnRequest): Promise<{ messages: Array<{ role: "system" | "user" | "assistant"; content: string }> }> {
        const prepared = await prepareChatTurnContext({
            stores: this.deps.stores,
            userId: input.userId,
            characterId: input.characterId,
            conversationId: input.conversationId,
            userMessageText: input.userMessageText,
            llmResponseMode: input.llmResponseMode,
            senderActorId: input.senderActorId,
            persistUserMessage: false,
        });

        return { messages: prepared.rendered.messages };
    }

    async chatTurn(input: PersonaChatTurnRequest): Promise<{
        requestId: string;
        model: string;
        output: string;
        userMessageId: string;
        assistantMessageId?: string;
        structuredOutput?: PersonaChatResponse["structuredOutput"];
        assembledMessages?: Array<{ role: "system" | "user" | "assistant"; content: string }>;
    }> {
        const prepared = await prepareChatTurnContext({
            stores: this.deps.stores,
            userId: input.userId,
            characterId: input.characterId,
            conversationId: input.conversationId,
            userMessageText: input.userMessageText,
            llmResponseMode: input.llmResponseMode,
            senderActorId: input.senderActorId,
            persistUserMessage: true,
        });

        const modelService = await this.deps.getModelServiceForUser(input.userId);
        const response = await modelService.chat({
            messages: prepared.rendered.messages,
            mode: input.llmResponseMode,
            functionName: "chat",
        });

        const selfActor = prepared.promptContext.actorMap.get(prepared.selfActorId);
        const normalizedAssistantOutput = normalizeAssistantOutput(response.output, [
            selfActor?.displayName,
            prepared.promptContext.character?.displayName,
            prepared.promptContext.character?.name,
        ]);

        const shouldSkip = input.llmResponseMode === "structured" && (
            response.structuredOutput?.action === "skip"
            || normalizedAssistantOutput.trim().length === 0
        );

        if (shouldSkip) {
            return {
                requestId: response.requestId,
                model: response.model,
                output: "",
                userMessageId: prepared.userMessage.id,
                ...(response.structuredOutput ? { structuredOutput: response.structuredOutput } : {}),
                ...(input.includeAssembledMessages ? { assembledMessages: prepared.rendered.messages } : {}),
            };
        }

        const assistantMessageId = crypto.randomUUID();
        await this.deps.stores.chat.appendMessage({
            id: assistantMessageId,
            conversationId: input.conversationId,
            senderActorId: prepared.selfActorId,
            content: normalizedAssistantOutput,
            createdAt: new Date().toISOString(),
        });

        return {
            requestId: response.requestId,
            model: response.model,
            output: normalizedAssistantOutput,
            userMessageId: prepared.userMessage.id,
            assistantMessageId,
            ...(response.structuredOutput ? { structuredOutput: response.structuredOutput } : {}),
            ...(input.includeAssembledMessages ? { assembledMessages: prepared.rendered.messages } : {}),
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
        const prepared = await prepareChatTurnContext({
            stores: this.deps.stores,
            userId: input.userId,
            characterId: input.characterId,
            conversationId: input.conversationId,
            userMessageText: input.userMessageText,
            llmResponseMode: input.llmResponseMode,
            senderActorId: input.senderActorId,
            persistUserMessage: true,
        });

        const selfActor = prepared.promptContext.actorMap.get(prepared.selfActorId);
        const normalizeNames = [
            selfActor?.displayName,
            prepared.promptContext.character?.displayName,
            prepared.promptContext.character?.name,
        ];

        let rawAccumulatedOutput = "";
        let normalizedSentLength = 0;

        const modelService = await this.deps.getModelServiceForUser(input.userId);
        if (input.includeAssembledMessages) {
            input.onAssembledMessages?.(prepared.rendered.messages);
        }
        const streamResponse = await modelService.chatStream({
            messages: prepared.rendered.messages,
            mode: input.llmResponseMode,
            functionName: "chat",
            onTextDelta: (rawDelta: string) => {
                rawAccumulatedOutput += rawDelta;
                const normalizedSoFar = normalizeAssistantOutput(rawAccumulatedOutput, normalizeNames);
                if (normalizedSoFar.length <= normalizedSentLength) {
                    return;
                }
                const chunk = normalizedSoFar.slice(normalizedSentLength);
                normalizedSentLength = normalizedSoFar.length;
                input.onChunk?.(chunk);
            },
        });

        const fullResponse = normalizeAssistantOutput(streamResponse.output, normalizeNames);
        if (fullResponse.length > normalizedSentLength) {
            const tail = fullResponse.slice(normalizedSentLength);
            input.onChunk?.(tail);
        }

        const assistantMessageId = crypto.randomUUID();
        await this.deps.stores.chat.appendMessage({
            id: assistantMessageId,
            conversationId: input.conversationId,
            senderActorId: prepared.selfActorId,
            content: fullResponse,
            createdAt: new Date().toISOString(),
        });

        return {
            requestId: streamResponse.requestId,
            model: streamResponse.model,
            output: fullResponse,
            userMessageId: prepared.userMessage.id,
            assistantMessageId,
            ...(input.includeAssembledMessages ? { assembledMessages: prepared.rendered.messages } : {}),
            streamCompleted: streamResponse.streamCompleted ?? streamResponse.completed,
            streamFinishReason: streamResponse.streamFinishReason ?? streamResponse.finishReason,
        };
    }
}
