import { eq, and, isNull } from "drizzle-orm";
import { conversationParticipants, type ConversationParticipantRow } from "./schema.js";
import type { DrizzleDb } from "./openDatabase.js";
import type {
    ConversationParticipant,
    ConversationParticipantRole,
    ConversationParticipantSourceType,
} from "@ss-ai/persona-flow";
import type {
    ConversationParticipantStore,
    AddConversationParticipantInput,
    UpdateConversationParticipantInput,
} from "@ss-ai/persona-flow";

function rowToParticipant(row: ConversationParticipantRow): ConversationParticipant {
    return {
        id: row.id,
        conversationId: row.conversationId,
        role: row.role as ConversationParticipantRole,
        sourceType: row.sourceType as ConversationParticipantSourceType,
        displayName: row.displayName,
        userProfileId: row.userProfileId ?? null,
        characterId: row.characterId ?? null,
        profileSnapshotJson: row.profileSnapshotJson ?? null,
        leftAt: row.leftAt ?? null,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
    };
}

export class SQLiteConversationParticipantStore implements ConversationParticipantStore {
    constructor(private readonly db: DrizzleDb) { }

    async getParticipantById(id: string): Promise<ConversationParticipant | null> {
        const rows = await this.db
            .select()
            .from(conversationParticipants)
            .where(eq(conversationParticipants.id, id))
            .limit(1);

        return rows.length > 0 ? rowToParticipant(rows[0]) : null;
    }

    async listConversationParticipants(input: {
        conversationId: string;
        activeOnly?: boolean;
    }): Promise<ConversationParticipant[]> {
        const condition = input.activeOnly
            ? and(
                eq(conversationParticipants.conversationId, input.conversationId),
                isNull(conversationParticipants.leftAt),
            )
            : eq(conversationParticipants.conversationId, input.conversationId);

        const rows = await this.db
            .select()
            .from(conversationParticipants)
            .where(condition);

        return rows.map(rowToParticipant);
    }

    async addConversationParticipant(input: AddConversationParticipantInput): Promise<ConversationParticipant> {
        const now = new Date().toISOString();
        const participant: ConversationParticipant = {
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

        await this.createParticipant(participant);
        return participant;
    }

    async updateConversationParticipant(input: UpdateConversationParticipantInput): Promise<void> {
        const now = new Date().toISOString();
        const updates: Partial<ConversationParticipantRow> = { updatedAt: now };

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
            .update(conversationParticipants)
            .set(updates)
            .where(eq(conversationParticipants.id, input.id));
    }

    async createParticipant(participant: ConversationParticipant): Promise<void> {
        await this.db.insert(conversationParticipants).values({
            id: participant.id,
            conversationId: participant.conversationId,
            role: participant.role,
            sourceType: participant.sourceType,
            displayName: participant.displayName,
            userProfileId: participant.userProfileId,
            characterId: participant.characterId,
            profileSnapshotJson: participant.profileSnapshotJson,
            leftAt: participant.leftAt,
            createdAt: participant.createdAt,
            updatedAt: participant.updatedAt,
        });
    }
}
