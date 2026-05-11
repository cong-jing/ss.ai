// 一条消息的完整 domain model
export type Message = {
    id: string;
    conversationId: string;
    /** Points to conversation_actors.id — identifies the actual speaker. */
    senderActorId: string;
    content: string;
    createdAt: string; // ISO 8601 字符串
};
