import { eq, and, isNull } from "drizzle-orm";
import { conversationActors, conversations, type ConversationActorRow } from "./schema.js";
import type { DrizzleDb } from "./openDatabase.js";
import type { CharacterDbRouter } from "./CharacterDbRouter.js";
import type {
    ConversationActor,
    ConversationActorRole,
    ConversationActorSourceType,
} from "@ss-ai/persona-flow";
import type {
    ConversationActorStore,
    AddConversationActorInput,
    UpdateConversationActorInput,
} from "@ss-ai/persona-flow";

function rowToActor(row: ConversationActorRow): ConversationActor {
    return {
        id: row.id,
        conversationId: row.conversationId,
        role: row.role as ConversationActorRole,
        sourceType: row.sourceType as ConversationActorSourceType,
        displayName: row.displayName,
        userProfileId: row.userProfileId ?? null,
        characterId: row.characterId ?? null,
        profileSnapshotJson: row.profileSnapshotJson ?? null,
        leftAt: row.leftAt ?? null,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
    };
}

export class SQLiteConversationActorStore implements ConversationActorStore {
    constructor(
        private readonly db: DrizzleDb,
        private readonly characterDbRouter?: CharacterDbRouter,
    ) { }

    /**
     * TODO: 分库模式下目前是依据核心会话索引遍历角色库查找。后面如果想提速，需要补一�?actor_index �?core.db �?O(1) 定位�?
     */
    async getActorById(id: string): Promise<ConversationActor | null> {
        if (this.characterDbRouter) {
            const indexedConversations = await this.db
                .select({ id: conversations.id, userId: conversations.userId, characterId: conversations.characterId })
                .from(conversations);
            for (const conversation of indexedConversations) {
                const conversationDb = this.characterDbRouter.getDbForCharacter({
                    userId: conversation.userId,
                    characterId: conversation.characterId,
                });
                const rows = await conversationDb
                    .select()
                    .from(conversationActors)
                    .where(eq(conversationActors.id, id))
                    .limit(1);
                if (rows.length > 0) {
                    return rowToActor(rows[0]);
                }
            }
            return null;
        }
        const rows = await this.db.select().from(conversationActors).where(eq(conversationActors.id, id)).limit(1);

        return rows.length > 0 ? rowToActor(rows[0]) : null;
    }

    async listConversationActors(input: {
        conversationId: string;
        activeOnly?: boolean;
    }): Promise<ConversationActor[]> {
        const db = await this.getDbForConversation(input.conversationId);
        const condition = input.activeOnly
            ? and(
                eq(conversationActors.conversationId, input.conversationId),
                isNull(conversationActors.leftAt),
            )
            : eq(conversationActors.conversationId, input.conversationId);

        const rows = await db
            .select()
            .from(conversationActors)
            .where(condition);

        return rows.map(rowToActor);
    }

    async addConversationActor(input: AddConversationActorInput): Promise<ConversationActor> {
        const now = new Date().toISOString();
        const actor: ConversationActor = {
            id: crypto.randomUUID(),
            conversationId: input.conversationId,
            role: input.role,
            sourceType: input.sourceType,
            displayName: input.displayName,
            userProfileId: input.userProfileId ?? null,
            characterId: input.characterId ?? null,
            profileSnapshotJson: input.profileSnapshotJson ?? null,
            leftAt: null,
            createdAt: now,
            updatedAt: now,
        };

        await this.createActor(actor);
        return actor;
    }

    async updateConversationActor(input: UpdateConversationActorInput): Promise<void> {
        const actor = await this.getActorById(input.id);
        if (!actor) {
            return;
        }

        const db = await this.getDbForConversation(actor.conversationId);
        const now = new Date().toISOString();
        const updates: Partial<ConversationActorRow> = { updatedAt: now };

        if (input.displayName !== undefined) {
            updates.displayName = input.displayName;
        }
        if (input.profileSnapshotJson !== undefined) {
            updates.profileSnapshotJson = input.profileSnapshotJson;
        }
        if (input.leftAt !== undefined) {
            updates.leftAt = input.leftAt;
        }

        await db
            .update(conversationActors)
            .set(updates)
            .where(eq(conversationActors.id, input.id));
    }

    async createActor(actor: ConversationActor): Promise<void> {
        const db = await this.getDbForConversation(actor.conversationId);
        await db.insert(conversationActors).values({
            id: actor.id,
            conversationId: actor.conversationId,
            role: actor.role,
            sourceType: actor.sourceType,
            displayName: actor.displayName,
            userProfileId: actor.userProfileId,
            characterId: actor.characterId,
            profileSnapshotJson: actor.profileSnapshotJson,
            leftAt: actor.leftAt,
            createdAt: actor.createdAt,
            updatedAt: actor.updatedAt,
        });
    }

    private async getDbForConversation(conversationId: string): Promise<DrizzleDb> {
        if (!this.characterDbRouter) {
            return this.db;
        }
        return await this.characterDbRouter.getDbForConversation({ conversationId });
    }
}
