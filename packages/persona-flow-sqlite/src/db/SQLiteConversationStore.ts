import type { ConversationStore, CreateConversationResult, Conversation } from "@ss-ai/persona-flow";
import { and, eq, desc } from "drizzle-orm";
import { conversations, messages, conversationActors } from "./schema.js";
import type { DrizzleDb } from "./openDatabase.js";
import type { CharacterDbRouter } from "./CharacterDbRouter.js";

export class SQLiteConversationStore implements ConversationStore {
    constructor(
        private readonly db: DrizzleDb,
        private readonly characterDbRouter?: CharacterDbRouter,
    ) { }

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
        const conversationDb = this.getDbForCharacter(conversation.userId, conversation.characterId);

        await this.db.insert(conversations).values({
            id: conversation.id,
            userId: conversation.userId,
            characterId: conversation.characterId,
            title: conversation.title ?? null,
            createdAt: conversation.createdAt,
            updatedAt: conversation.updatedAt,
        });

        // Auto-create: self (AI character) actor
        const selfActorId = crypto.randomUUID();
        await conversationDb.insert(conversationActors).values({
            id: selfActorId,
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

        // Auto-create: system actor
        const systemActorId = crypto.randomUUID();
        await conversationDb.insert(conversationActors).values({
            id: systemActorId,
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

        return { selfActorId, systemActorId };
    }

    async deleteConversation(input: { userId: string; conversationId: string }): Promise<void> {
        const conversation = await this.getConversationById(input);
        if (!conversation) {
            return;
        }
        const conversationDb = this.getDbForCharacter(conversation.userId, conversation.characterId);
        // Delete messages, then actors, then the conversation record
        await conversationDb.delete(messages).where(
            eq(messages.conversationId, input.conversationId),
        );
        await conversationDb.delete(conversationActors).where(
            eq(conversationActors.conversationId, input.conversationId),
        );
        await this.db.delete(conversations).where(and(
            eq(conversations.userId, input.userId),
            eq(conversations.id, input.conversationId),
        ));
    }

    async updateConversationTitle(input: {
        userId: string;
        conversationId: string;
        title: string | null;
        updatedAt: string;
    }): Promise<void> {
        await this.db.update(conversations)
            .set({ title: input.title, updatedAt: input.updatedAt })
            .where(and(
                eq(conversations.userId, input.userId),
                eq(conversations.id, input.conversationId),
            ));
    }

    private getDbForCharacter(userId: string, characterId: string): DrizzleDb {
        if (!this.characterDbRouter) {
            return this.db;
        }
        return this.characterDbRouter.getDbForCharacter({ userId, characterId });
    }
}
