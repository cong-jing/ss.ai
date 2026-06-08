type ConversationType = "user" | "group";

import { getConversationId, setConversationId } from "../conversationStore.js";
import { getGlobalLogger } from "@ss-ai/persona-flow-logger";
import { chat, createConversation } from "../http/serverClient.js";

export async function resolveConversationIdForMessage(
    characterId: string | null,
    type: ConversationType,
    id: string | number,
): Promise<string | null> {
    if (!characterId) {
        getGlobalLogger().warn("[bot] character not initialized, skipping message");
        return null;
    }

    let conversationId = getConversationId(type, id);
    if (!conversationId) {
        getGlobalLogger().info(`[bot] no conversation for ${type}:${id}, creating new one`);
        conversationId = await createConversation(characterId);
        setConversationId(type, id, conversationId);
    }

    return conversationId;
}

export async function chatForMessage(
    characterId: string | null,
    conversationId: string,
    userMessageText: string,
    senderActorId: string | undefined,
): Promise<string | null> {
    if (!characterId) {
        getGlobalLogger().warn("[bot] character not initialized, skipping message");
        return null;
    }

    getGlobalLogger().info(
        `[bot] chat: character=${characterId}, conversation=${conversationId}, senderActorId=${senderActorId ?? "(none)"}, userMessageText="${userMessageText}"`,
    );

    const reply = await chat(characterId, conversationId, userMessageText, senderActorId);
    if (reply == null) {
        getGlobalLogger().info("[bot] chat skipped: assistant turn had no replyText");
        return null;
    }

    getGlobalLogger().info(`[bot] reply: "${reply}"`);
    return reply;
}
