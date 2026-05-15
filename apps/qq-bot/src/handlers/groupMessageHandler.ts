import type { MessageHandlerContext } from "./messageHandlerContext.js";
import { createLocalActor } from "../http/serverClient.js";
import {
    getGroupMemberActorBinding,
    setGroupMemberActorBinding,
} from "../conversationStore.js";
import { getGlobalLogger } from "@ss-ai/persona-flow-logger";
import { chatForMessage, resolveConversationIdForMessage } from "./messageRuntime.js";

function includesAtSelf(event: any, selfId: string | number): boolean {
    if (Array.isArray(event.message)) {
        for (const segment of event.message) {
            if (segment?.type !== "at") continue;
            if (String(segment?.data?.qq ?? "") === String(selfId)) {
                return true;
            }
        }
    }

    const raw = String(event.raw_message ?? "");
    const atSelfPattern = new RegExp(`\\[CQ:at,qq=${String(selfId).replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}\\]`);
    return atSelfPattern.test(raw);
}

function removeAtSelfPrefix(text: string, selfId: string | number): string {
    const atSelfPattern = new RegExp(`\\[CQ:at,qq=${String(selfId).replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}\\]`, "g");
    return text.replace(atSelfPattern, "").trim();
}

function resolveGroupDisplayName(event: any): string {
    const sender = event.sender ?? {};
    const candidate = sender.card
        ?? sender.nickname
        ?? sender.remark
        ?? sender.name
        ?? String(event.user_id ?? "group-user");
    const text = String(candidate).trim();
    return text || String(event.user_id ?? "group-user");
}

function buildGroupProfileSnapshot(event: any): string {
    const payload = {
        source: "qq_group",
        groupId: event.group_id ?? null,
        userId: event.user_id ?? null,
        sender: event.sender ?? null,
    };
    return JSON.stringify(payload);
}

export async function handleGroupMessage(event: any, context: MessageHandlerContext): Promise<void> {
    const selfId = context.getBotSelfId();
    if (selfId == null) {
        getGlobalLogger().info("[bot] TODO: group @self filter needs selfId, skip this message for now");
        return;
    }

    if (!includesAtSelf(event, selfId)) {
        return;
    }

    const text: string = (event.raw_message ?? "").trim();
    if (!text) return;

    const userMessageText = removeAtSelfPrefix(text, selfId);
    if (!userMessageText) {
        return;
    }

    const conversationId = await resolveConversationIdForMessage(
        context.getCharacterId(),
        "group",
        event.group_id,
    );
    if (!conversationId) return;

    let actorId: string | null = null;
    const binding = getGroupMemberActorBinding(event.group_id, event.user_id);
    if (binding && binding.conversationId === conversationId) {
        actorId = binding.actorId;
    } else {
        const displayName = resolveGroupDisplayName(event);
        const profileSnapshotJson = buildGroupProfileSnapshot(event);
        actorId = await createLocalActor(conversationId, displayName, profileSnapshotJson);
        setGroupMemberActorBinding(event.group_id, event.user_id, { conversationId, actorId });
        getGlobalLogger().info("[bot] group actor binding created", {
            groupId: event.group_id,
            userId: event.user_id,
            conversationId,
            actorId,
            displayName,
        });
    }

    const reply = await chatForMessage(
        context.getCharacterId(),
        conversationId,
        userMessageText,
        actorId ?? undefined,
    );
    if (!reply) return;

    context.sendAction("send_group_msg", {
        group_id: event.group_id,
        message: reply,
    });
}
