import type { MessageKind, TurnEvent } from "@ss-ai/contracts";

export type Message = {
    id: string;
    conversationId: string;
    /** Points to conversation_actors.id — identifies the actual speaker. */
    senderActorId: string;
    kind: MessageKind;
    displayText: string;
    turnEvents?: TurnEvent[];
    createdAt: string; // ISO 8601 字符串
};

export type { MessageKind };
