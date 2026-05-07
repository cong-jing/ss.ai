import type { Message } from "./message.js";

// 持久化接口 —— 具体实现（SQLite / 内存 / 云数据库）由外部注入
export interface MessageStore {
    // 追加一条消息
    appendMessage(message: Message): Promise<void>;

    // 查询某用户某会话最近 N 条消息，返回结果按时间升序（旧→新）
    getRecentMessages(input: {
        userId: string;
        conversationId: string;
        limit: number;
    }): Promise<Message[]>;
}
