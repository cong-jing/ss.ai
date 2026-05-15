type ConversationType = "user" | "group";

import { getConversationId, setConversationId } from "../conversationStore.js";
import { logInfo, logWarn } from "../logger.js";
import { chat, createConversation } from "../http/serverClient.js";

export async function resolveConversationIdForMessage(
    characterId: string | null,
    type: ConversationType,
    id: string | number,
): Promise<string | null> {
    if (!characterId) {
        logWarn("[bot] character not initialized, skipping message");
        return null;
    }

    let conversationId = getConversationId(type, id);
    if (!conversationId) {
        logInfo(`[bot] no conversation for ${type}:${id}, creating new one`);
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
        logWarn("[bot] character not initialized, skipping message");
        return null;
    }

    logInfo(
        `[bot] chat: character=${characterId}, conversation=${conversationId}, senderActorId=${senderActorId ?? "(none)"}, userMessageText="${userMessageText}"`,
    );

    const reply = await chat(characterId, conversationId, userMessageText, senderActorId);
    if (reply == null) {
        logInfo("[bot] chat skipped by structured decision");
        return null;
    }

    logInfo(`[bot] reply: "${reply}"`);
    return reply;
}
