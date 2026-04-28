import { eq, desc } from "drizzle-orm";
import { messages, type MessageRow } from "./schema";
import type { DrizzleDb } from "./openDatabase";
import type { Message, MessageStore, ChatRole } from "../../../persona-flow/src/index";

// 把数据库行转成 domain Message
// role 从数据库读出是普通 string，这里做一次简单的类型断言
function rowToMessage(row: MessageRow): Message {
    return {
        id: row.id,
        conversationId: row.conversationId,
        role: row.role as ChatRole,
        content: row.content,
        createdAt: row.createdAt,
    };
}

export class SQLiteMessageStore implements MessageStore {
    constructor(private readonly db: DrizzleDb) { }

    async appendMessage(message: Message): Promise<void> {
        // Drizzle insert —— 字段名来自 schema，不手写字符串
        await this.db.insert(messages).values({
            id: message.id,
            conversationId: message.conversationId,
            role: message.role,
            content: message.content,
            createdAt: message.createdAt,
        });
    }

    async getRecentMessages(input: {
        conversationId: string;
        limit: number;
    }): Promise<Message[]> {
        // 按 createdAt DESC 取最新 N 条，再 reverse 成时间升序返回给调用方
        const rows = await this.db
            .select()
            .from(messages)
            .where(eq(messages.conversationId, input.conversationId))
            .orderBy(desc(messages.createdAt))
            .limit(input.limit);

        return rows.map(rowToMessage).reverse();
    }
}
