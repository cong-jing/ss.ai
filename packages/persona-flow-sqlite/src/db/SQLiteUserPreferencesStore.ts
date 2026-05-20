import { eq } from "drizzle-orm";
import { userPreferences, type UserPreferencesRow } from "./schema.js";
import type { DrizzleDb } from "./openDatabase.js";
import type { ModelAssignment, ModelAssignmentMap, ModelCallPurpose } from "@ss-ai/contracts";
import type { UserPreferences, UserPreferencesStore } from "@ss-ai/persona-flow";

function safeParseModelAssignments(json: string): ModelAssignmentMap {
    try {
        const parsed = JSON.parse(json);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            return parsed as ModelAssignmentMap;
        }
    } catch { /* fall through */ }
    return {};
}

function rowToPreferences(row: UserPreferencesRow): UserPreferences {
    return {
        userId: row.userId,
        currentCharacterId: row.currentCharacterId ?? null,
        modelAssignments: safeParseModelAssignments(row.modelAssignmentsJson),
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
    };
}

export class SQLiteUserPreferencesStore implements UserPreferencesStore {
    constructor(private readonly db: DrizzleDb) { }

    async getUserPreferences(userId: string): Promise<UserPreferences | null> {
        const rows = await this.db
            .select()
            .from(userPreferences)
            .where(eq(userPreferences.userId, userId))
            .limit(1);

        return rows.length > 0 ? rowToPreferences(rows[0]) : null;
    }

    async upsertUserPreferences(preferences: UserPreferences): Promise<void> {
        const row = {
            userId: preferences.userId,
            currentCharacterId: preferences.currentCharacterId ?? null,
            modelAssignmentsJson: JSON.stringify(preferences.modelAssignments),
            createdAt: preferences.createdAt,
            updatedAt: preferences.updatedAt,
        };

        await this.db
            .insert(userPreferences)
            .values(row)
            .onConflictDoUpdate({
                target: userPreferences.userId,
                set: {
                    currentCharacterId: row.currentCharacterId,
                    modelAssignmentsJson: row.modelAssignmentsJson,
                    updatedAt: row.updatedAt,
                },
            });
    }

    async setCurrentCharacter(input: { userId: string; characterId: string | null; updatedAt: string }): Promise<void> {
        await this.#ensureRow(input.userId);
        await this.db
            .update(userPreferences)
            .set({ currentCharacterId: input.characterId, updatedAt: input.updatedAt })
            .where(eq(userPreferences.userId, input.userId));
    }

    async setModelAssignment(input: { userId: string; modelCallPurpose: ModelCallPurpose; assignment: ModelAssignment; updatedAt: string }): Promise<void> {
        await this.#ensureRow(input.userId);
        const existing = await this.getUserPreferences(input.userId);
        const modelAssignments: ModelAssignmentMap = {
            ...(existing?.modelAssignments ?? {}),
            [input.modelCallPurpose]: input.assignment,
        };
        await this.db
            .update(userPreferences)
            .set({ modelAssignmentsJson: JSON.stringify(modelAssignments), updatedAt: input.updatedAt })
            .where(eq(userPreferences.userId, input.userId));
    }

    /** Insert a default row if none exists yet (for update-only operations). */
    async #ensureRow(userId: string): Promise<void> {
        const now = new Date().toISOString();
        await this.db
            .insert(userPreferences)
            .values({ userId, modelAssignmentsJson: "{}", createdAt: now, updatedAt: now })
            .onConflictDoNothing();
    }
}
