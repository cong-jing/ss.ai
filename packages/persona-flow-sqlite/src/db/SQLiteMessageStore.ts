import { and, eq, desc } from "drizzle-orm";
import { messages, type MessageRow } from "./schema.js";
import type { DrizzleDb } from "./openDatabase.js";
import type { Message, ChatRole } from "@ss-ai/persona-flow";

function rowToMessage(row: MessageRow): Message {
    return {
        id: row.id,
        userId: row.userId,
        conversationId: row.conversationId,
        role: row.role as ChatRole,
        content: row.content,
        createdAt: row.createdAt,
    };
}

export class SQLiteMessageStore {
    constructor(private readonly db: DrizzleDb) { }

    async appendMessage(message: Message): Promise<void> {
        await this.db.insert(messages).values({
            id: message.id,
            userId: message.userId,
            conversationId: message.conversationId,
            role: message.role,
            content: message.content,
            createdAt: message.createdAt,
        });
    }

    async getRecentMessages(input: {
        userId: string;
        conversationId: string;
        limit: number;
    }): Promise<Message[]> {
        const rows = await this.db
            .select()
            .from(messages)
            .where(and(
                eq(messages.userId, input.userId),
                eq(messages.conversationId, input.conversationId),
            ))
            .orderBy(desc(messages.createdAt))
            .limit(input.limit);

        return rows.map(rowToMessage).reverse();
    }
}
