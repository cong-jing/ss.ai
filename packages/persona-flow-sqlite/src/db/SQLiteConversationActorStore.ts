import { eq, and, isNull } from "drizzle-orm";
import { conversationActors, type ConversationActorRow } from "./schema.js";
import type { DrizzleDb } from "./openDatabase.js";
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
    constructor(private readonly db: DrizzleDb) { }

    async getActorById(id: string): Promise<ConversationActor | null> {
        const rows = await this.db
            .select()
            .from(conversationActors)
            .where(eq(conversationActors.id, id))
            .limit(1);

        return rows.length > 0 ? rowToActor(rows[0]) : null;
    }

    async listConversationActors(input: {
        conversationId: string;
        activeOnly?: boolean;
    }): Promise<ConversationActor[]> {
        const condition = input.activeOnly
            ? and(
                eq(conversationActors.conversationId, input.conversationId),
                isNull(conversationActors.leftAt),
            )
            : eq(conversationActors.conversationId, input.conversationId);

        const rows = await this.db
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

        await this.db
            .update(conversationActors)
            .set(updates)
            .where(eq(conversationActors.id, input.id));
    }

    async createActor(actor: ConversationActor): Promise<void> {
        await this.db.insert(conversationActors).values({
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
}
