import type { MessageHandlerContext } from "./messageHandlerContext.js";
import { createLocalActor } from "../http/serverClient.js";
import {
    getPrivateActorBinding,
    setPrivateActorBinding,
} from "../conversationStore.js";
import { log } from "../logger.js";
import { chatForMessage, resolveConversationIdForMessage } from "./messageRuntime.js";

function resolvePrivateDisplayName(event: any): string {
    const sender = event.sender ?? {};
    const candidate = sender.remark
        ?? sender.nickname
        ?? sender.card
        ?? sender.name
        ?? String(event.user_id ?? "private-user");
    const text = String(candidate).trim();
    return text || String(event.user_id ?? "private-user");
}

function buildPrivateProfileSnapshot(event: any): string {
    const payload = {
        source: "qq_private",
        userId: event.user_id ?? null,
        sender: event.sender ?? null,
    };
    return JSON.stringify(payload);
}

export async function handlePrivateMessage(event: any, context: MessageHandlerContext): Promise<void> {
    const text: string = (event.raw_message ?? "").trim();
    if (!text) return;

    const conversationId = await resolveConversationIdForMessage(
        context.getCharacterId(),
        "user",
        event.user_id,
    );
    if (!conversationId) return;

    let actorId: string | null = null;
    const binding = getPrivateActorBinding(event.user_id);
    if (binding && binding.conversationId === conversationId) {
        actorId = binding.actorId;
    } else {
        const displayName = resolvePrivateDisplayName(event);
        const profileSnapshotJson = buildPrivateProfileSnapshot(event);
        actorId = await createLocalActor(conversationId, displayName, profileSnapshotJson);
        setPrivateActorBinding(event.user_id, { conversationId, actorId });
        log("[bot] private actor binding created", {
            userId: event.user_id,
            conversationId,
            actorId,
            displayName,
        });
    }

    const reply = await chatForMessage(
        context.getCharacterId(),
        conversationId,
        text,
        actorId ?? undefined,
    );
    if (!reply) return;

    context.sendAction("send_private_msg", {
        user_id: event.user_id,
        message: reply,
    });
}
