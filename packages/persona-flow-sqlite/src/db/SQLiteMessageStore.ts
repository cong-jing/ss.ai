import { and, eq, desc } from "drizzle-orm";
import { messages, type MessageRow } from "./schema.js";
import type { DrizzleDb } from "./openDatabase.js";
import type { Message } from "@ss-ai/persona-flow";

function rowToMessage(row: MessageRow): Message {
    return {
        id: row.id,
        conversationId: row.conversationId,
        senderActorId: row.senderActorId,
        content: row.content,
        createdAt: row.createdAt,
    };
}

export class SQLiteMessageStore {
    constructor(private readonly db: DrizzleDb) { }

    async appendMessage(message: Message): Promise<void> {
        await this.db.insert(messages).values({
            id: message.id,
            conversationId: message.conversationId,
            senderActorId: message.senderActorId,
            content: message.content,
            createdAt: message.createdAt,
        });
    }

    async getRecentMessages(input: {
        userId?: string;
        conversationId: string;
        limit: number;
    }): Promise<Message[]> {
        const rows = await this.db
            .select()
            .from(messages)
            .where(eq(messages.conversationId, input.conversationId))
            .orderBy(desc(messages.createdAt))
            .limit(input.limit);

        return rows.map(rowToMessage).reverse();
    }

    async deleteMessage(input: { conversationId: string; messageId: string }): Promise<void> {
        await this.db
            .delete(messages)
            .where(and(
                eq(messages.conversationId, input.conversationId),
                eq(messages.id, input.messageId),
            ));
    }
}
