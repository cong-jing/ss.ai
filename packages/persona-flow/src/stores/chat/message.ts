// 一条消息的完整 domain model
export type Message = {
    id: string;
    conversationId: string;
    /** Points to conversation_participants.id — identifies the actual speaker. */
    senderParticipantId: string;
    content: string;
    createdAt: string; // ISO 8601 字符串
};
