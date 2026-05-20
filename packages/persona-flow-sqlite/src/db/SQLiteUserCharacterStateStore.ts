import { and, eq } from "drizzle-orm";
import { userCharacterStates, type UserCharacterStateRow } from "./schema.js";
import type { DrizzleDb } from "./openDatabase.js";
import type { UserCharacterState } from "@ss-ai/persona-flow";
import type { CharacterDbRouter } from "./CharacterDbRouter.js";

function rowToState(row: UserCharacterStateRow): UserCharacterState {
    return {
        userId: row.userId,
        characterId: row.characterId,
        currentConversationId: row.currentConversationId,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
    };
}

export class SQLiteUserCharacterStateStore {
    constructor(
        private readonly db: DrizzleDb,
        private readonly characterDbRouter?: CharacterDbRouter,
    ) { }

    async getState(input: { userId: string; characterId: string }): Promise<UserCharacterState | null> {
        const db = this.getDbForCharacter(input.userId, input.characterId);
        const rows = await db
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
        const db = this.getDbForCharacter(state.userId, state.characterId);
        await db
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

    private getDbForCharacter(userId: string, characterId: string): DrizzleDb {
        if (!this.characterDbRouter) {
            return this.db;
        }
        return this.characterDbRouter.getDbForCharacter({ userId, characterId });
    }
}
