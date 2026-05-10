import type { ConversationStore, CreateConversationResult, Conversation } from "@ss-ai/persona-flow";
import { and, eq, desc } from "drizzle-orm";
import { conversations, messages, conversationParticipants } from "./schema.js";
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

    async createConversation(
        conversation: Conversation,
        options: { selfDisplayName: string },
    ): Promise<CreateConversationResult> {
        const now = new Date().toISOString();

        await this.db.insert(conversations).values({
            id: conversation.id,
            userId: conversation.userId,
            characterId: conversation.characterId,
            title: conversation.title ?? null,
            createdAt: conversation.createdAt,
            updatedAt: conversation.updatedAt,
        });

        // Auto-create: self (AI character) participant
        const selfParticipantId = crypto.randomUUID();
        await this.db.insert(conversationParticipants).values({
            id: selfParticipantId,
            conversationId: conversation.id,
            role: "self",
            sourceType: "ai_character",
            displayName: options.selfDisplayName,
            characterId: conversation.characterId,
            userProfileId: null,
            profileSnapshotJson: null,
            leftAt: null,
            createdAt: now,
            updatedAt: now,
        });

        // Auto-create: system participant
        const systemParticipantId = crypto.randomUUID();
        await this.db.insert(conversationParticipants).values({
            id: systemParticipantId,
            conversationId: conversation.id,
            role: "system",
            sourceType: "system",
            displayName: "系统",
            characterId: null,
            userProfileId: null,
            profileSnapshotJson: null,
            leftAt: null,
            createdAt: now,
            updatedAt: now,
        });

        return { selfParticipantId, systemParticipantId };
    }

    async deleteConversation(input: { userId: string; conversationId: string }): Promise<void> {
        // Delete messages, then participants, then the conversation record
        await this.db.delete(messages).where(
            eq(messages.conversationId, input.conversationId),
        );
        await this.db.delete(conversationParticipants).where(
            eq(conversationParticipants.conversationId, input.conversationId),
        );
        await this.db.delete(conversations).where(and(
            eq(conversations.userId, input.userId),
            eq(conversations.id, input.conversationId),
        ));
    }
}
