import type { ConversationActorSourceType } from "@ss-ai/contracts";
import type { Request } from "express";
import { resolveRequestUserId, type HttpApiContext } from "../apiContext.js";
import { HttpStatusError } from "./chatUtil.js";

export async function handleGetConversationMessages(context: HttpApiContext, req: Request, conversationId: string) {
    const userId = await resolveRequestUserId(req, context);
    const conversation = await context.stores.conversation.getConversationById({
        userId,
        conversationId,
    });
    if (!conversation) {
        throw new HttpStatusError(404, `Conversation not found: ${conversationId}`);
    }

    const [messages, actors, character] = await Promise.all([
        context.stores.chat.getRecentMessages({ userId, conversationId, limit: 200 }),
        context.stores.conversationActor.listConversationActors({ conversationId }),
        context.stores.character.getCharacterById({
            userId,
            characterId: conversation.characterId,
        }),
    ]);

    const actorMap = new Map(actors.map(p => [p.id, p]));
    return {
        messages: messages.map(m => {
            const p = actorMap.get(m.senderActorId);
            const role: "user" | "assistant" = p?.role === "self" ? "assistant" : "user";
            const senderDisplayName = p?.role === "self"
                ? (character?.displayName ?? character?.name ?? p?.displayName ?? "assistant")
                : (p?.displayName ?? "unknown");
            const senderSourceType: ConversationActorSourceType = p?.sourceType ?? "local_actor";
            return {
                id: m.id,
                role,
                senderActorId: m.senderActorId,
                senderDisplayName,
                senderSourceType,
                content: m.content,
                createdAt: m.createdAt,
            };
        }),
    };
}

export async function handleDeleteConversationMessage(context: HttpApiContext, req: Request, conversationId: string, messageId: string) {
    const userId = await resolveRequestUserId(req, context);
    const conversation = await context.stores.conversation.getConversationById({
        userId,
        conversationId,
    });
    if (!conversation) {
        throw new HttpStatusError(404, `Conversation not found: ${conversationId}`);
    }

    await context.stores.chat.deleteMessage({ conversationId, messageId });
    return { messageId };
}
