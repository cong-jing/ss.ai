import type { ConversationStore, Conversation } from "@ss-ai/persona-flow";
import { and, eq, desc } from "drizzle-orm";
import { conversations, messages } from "./schema.js";
import type { DrizzleDb } from "./openDatabase.js";

export class SQLiteConversationStore implements ConversationStore {
    constructor(private readonly db: DrizzleDb) { }

    async listConversations(input: { userId: string; characterId: string }): Promise<Conversation[]> {
        const rows = await this.db
            .select()
            .from(conversations)
            .where(and(
                eq(conversations.userId, input.userId),
                eq(conversations.characterId, input.characterId),
            ))
            .orderBy(desc(conversations.createdAt));

        return rows.map(r => ({
            id: r.id,
            userId: r.userId,
            characterId: r.characterId,
            title: r.title ?? null,
            createdAt: r.createdAt,
            updatedAt: r.updatedAt,
        }));
    }

    async getConversationById(input: { userId: string; conversationId: string }): Promise<Conversation | null> {
        const rows = await this.db
            .select()
            .from(conversations)
            .where(and(
                eq(conversations.userId, input.userId),
                eq(conversations.id, input.conversationId),
            ))
            .limit(1);

        if (rows.length === 0) return null;
        const r = rows[0];
        return {
            id: r.id,
            userId: r.userId,
            characterId: r.characterId,
            title: r.title ?? null,
            createdAt: r.createdAt,
            updatedAt: r.updatedAt,
        };
    }

    async createConversation(conversation: Conversation): Promise<void> {
        await this.db.insert(conversations).values({
            id: conversation.id,
            userId: conversation.userId,
            characterId: conversation.characterId,
            title: conversation.title ?? null,
            createdAt: conversation.createdAt,
            updatedAt: conversation.updatedAt,
        });
    }

    async deleteConversation(input: { userId: string; conversationId: string }): Promise<void> {
        // Delete messages first, then the conversation record
        await this.db.delete(messages).where(and(
            eq(messages.userId, input.userId),
            eq(messages.conversationId, input.conversationId),
        ));
        await this.db.delete(conversations).where(and(
            eq(conversations.userId, input.userId),
            eq(conversations.id, input.conversationId),
        ));
    }
}
