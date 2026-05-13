import type { PromptContext } from "../prompt/promptConext.js";
import { PromptContextBuilder } from "../prompt/promptConext.js";
import type { PromptRenderMode, RenderedPrompt } from "../prompt/promptRenderer.js";
import { promptRenderer } from "../prompt/promptRenderer.js";
import type { AppStores } from "../stores/appStores.js";
import type { Message } from "../stores/chat/message.js";

export class PersonaFlowTurnError extends Error {
    constructor(public readonly status: number, message: string) {
        super(message);
    }
}

function requireOtherActor(actor: {
    id: string;
    role: string;
} | undefined, senderActorId: string): string {
    if (!actor) {
        throw new PersonaFlowTurnError(404, `Sender actor not found: ${senderActorId}`);
    }
    if (actor.role !== "other") {
        throw new PersonaFlowTurnError(400, `Sender actor is not allowed: ${senderActorId}`);
    }
    return actor.id;
}

async function ensureUserActor(
    stores: AppStores,
    input: {
        conversationId: string;
        userId: string;
    },
): Promise<string> {
    const actors = await stores.conversationActor.listConversationActors({
        conversationId: input.conversationId,
        activeOnly: true,
    });

    const existing = actors.find(
        actor => actor.sourceType === "logged_user" && actor.userProfileId === input.userId,
    );
    if (existing) {
        return existing.id;
    }

    const userProfile = await stores.userProfile.getUserProfile(input.userId);
    const added = await stores.conversationActor.addConversationActor({
        conversationId: input.conversationId,
        role: "other",
        sourceType: "logged_user",
        displayName: userProfile?.name ?? input.userId,
        userProfileId: input.userId,
    });
    return added.id;
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripRepeatedPrefix(text: string, regex: RegExp): string {
    let output = text;
    while (regex.test(output)) {
        output = output.replace(regex, "");
    }
    return output;
}

export function normalizeAssistantOutput(output: string, names: Array<string | null | undefined>): string {
    let normalized = output.trimStart();
    normalized = stripRepeatedPrefix(normalized, /^p\d+\[[^\]]+\]\s*[:：]\s*/u);

    const uniqueNames = Array.from(new Set(
        names
            .map(name => (typeof name === "string" ? name.trim() : ""))
            .filter(Boolean),
    ));

    for (const name of uniqueNames) {
        const escapedName = escapeRegExp(name);
        normalized = stripRepeatedPrefix(normalized, new RegExp(`^${escapedName}\\s*[:：]\\s*`, "u"));
    }

    return normalized;
}

export interface PrepareChatTurnInput {
    stores: AppStores;
    userId: string;
    characterId: string;
    conversationId: string;
    userMessageText: string;
    llmResponseMode: PromptRenderMode;
    senderActorId?: unknown;
    persistUserMessage?: boolean;
}

export interface PreparedChatTurn {
    selfActorId: string;
    senderActorId: string;
    userMessage: Message;
    promptContext: PromptContext;
    rendered: RenderedPrompt;
}

export async function prepareChatTurnContext(input: PrepareChatTurnInput): Promise<PreparedChatTurn> {
    const persistUserMessage = input.persistUserMessage ?? true;

    const character = await input.stores.character.getCharacterById({
        userId: input.userId,
        characterId: input.characterId,
    });
    if (!character || character.status === "archived") {
        throw new PersonaFlowTurnError(404, `Character not found: ${input.characterId}`);
    }

    const conversation = await input.stores.conversation.getConversationById({
        userId: input.userId,
        conversationId: input.conversationId,
    });
    if (!conversation) {
        throw new PersonaFlowTurnError(404, `Conversation not found: ${input.conversationId}`);
    }
    if (conversation.characterId !== input.characterId) {
        throw new PersonaFlowTurnError(404, `Conversation not found for character: ${input.conversationId}`);
    }

    const actors = await input.stores.conversationActor.listConversationActors({
        conversationId: input.conversationId,
        activeOnly: true,
    });

    const selfActor = actors.find(actor => actor.role === "self");
    if (!selfActor) {
        throw new PersonaFlowTurnError(404, `Self actor not found for conversation ${input.conversationId}`);
    }

    let resolvedSenderActorId: string;
    const requestedSenderActorId = typeof input.senderActorId === "string"
        ? input.senderActorId.trim()
        : "";
    if (!requestedSenderActorId) {
        resolvedSenderActorId = await ensureUserActor(input.stores, {
            conversationId: input.conversationId,
            userId: input.userId,
        });
    } else {
        const senderActor = actors.find(actor => actor.id === requestedSenderActorId);
        resolvedSenderActorId = requireOtherActor(senderActor, requestedSenderActorId);
    }

    const userMessage: Message = {
        id: crypto.randomUUID(),
        conversationId: input.conversationId,
        senderActorId: resolvedSenderActorId,
        content: input.userMessageText,
        createdAt: new Date().toISOString(),
    };

    if (persistUserMessage) {
        await input.stores.chat.appendMessage(userMessage);
    }

    const promptContext = await PromptContextBuilder.build({
        userId: input.userId,
        characterId: input.characterId,
        conversationId: input.conversationId,
        currentUserMessage: userMessage,
        messageStore: input.stores.chat,
        userProfileStore: input.stores.userProfile,
        characterStore: input.stores.character,
        conversationActorStore: input.stores.conversationActor,
    });

    const rendered = promptRenderer.render(promptContext, { mode: input.llmResponseMode });

    return {
        selfActorId: selfActor.id,
        senderActorId: resolvedSenderActorId,
        userMessage,
        promptContext,
        rendered,
    };
}
