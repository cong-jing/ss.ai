import { and, eq } from "drizzle-orm";
import { userCharacterStates, type UserCharacterStateRow } from "./schema.js";
import type { DrizzleDb } from "./openDatabase.js";
import type { UserCharacterState, UserCharacterStateStore } from "@ss-ai/persona-flow";

function rowToState(row: UserCharacterStateRow): UserCharacterState {
    return {
        userId: row.userId,
        characterId: row.characterId,
        currentConversationId: row.currentConversationId,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
    };
}

export class SQLiteUserCharacterStateStore implements UserCharacterStateStore {
    constructor(private readonly db: DrizzleDb) { }

    async getState(input: { userId: string; characterId: string }): Promise<UserCharacterState | null> {
        const rows = await this.db
            .select()
            .from(userCharacterStates)
            .where(
                and(
                    eq(userCharacterStates.userId, input.userId),
                    eq(userCharacterStates.characterId, input.characterId)
                )
            )
            .limit(1);

        return rows.length > 0 ? rowToState(rows[0]) : null;
    }

    async upsertState(state: UserCharacterState): Promise<void> {
        await this.db
            .insert(userCharacterStates)
            .values({
                userId: state.userId,
                characterId: state.characterId,
                currentConversationId: state.currentConversationId,
                createdAt: state.createdAt,
                updatedAt: state.updatedAt,
            })
            .onConflictDoUpdate({
                target: [userCharacterStates.userId, userCharacterStates.characterId],
                set: {
                    currentConversationId: state.currentConversationId,
                    updatedAt: state.updatedAt,
                },
            });
    }
}
