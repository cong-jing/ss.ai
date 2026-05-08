// 消息的发送角色
export type ChatRole = "user" | "assistant" | "system";

// 一条消息的完整 domain model
export type Message = {
    id: string;
    userId: string;
    conversationId: string;
    role: ChatRole;
    content: string;
    createdAt: string; // ISO 8601 字符串
};
