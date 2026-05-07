import { eq } from "drizzle-orm";
import { userPreferences, type UserPreferencesRow } from "./schema.js";
import type { DrizzleDb } from "./openDatabase.js";
import type { UserPreferences, UserPreferencesStore, ModelSelection } from "@ss-ai/persona-flow";

function safeParseModels(json: string): Record<string, ModelSelection> {
    try {
        const parsed = JSON.parse(json);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            return parsed as Record<string, ModelSelection>;
        }
    } catch { /* fall through */ }
    return {};
}

function rowToPreferences(row: UserPreferencesRow): UserPreferences {
    return {
        userId: row.userId,
        currentCharacterId: row.currentCharacterId ?? null,
        functionModels: safeParseModels(row.functionModelsJson),
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
            functionModelsJson: JSON.stringify(preferences.functionModels),
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
                    functionModelsJson: row.functionModelsJson,
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

    async setFunctionModel(input: { userId: string; functionName: string; selection: ModelSelection; updatedAt: string }): Promise<void> {
        await this.#ensureRow(input.userId);
        const existing = await this.getUserPreferences(input.userId);
        const models = { ...(existing?.functionModels ?? {}), [input.functionName]: input.selection };
        await this.db
            .update(userPreferences)
            .set({ functionModelsJson: JSON.stringify(models), updatedAt: input.updatedAt })
            .where(eq(userPreferences.userId, input.userId));
    }

    /** Insert a default row if none exists yet (for update-only operations). */
    async #ensureRow(userId: string): Promise<void> {
        const now = new Date().toISOString();
        await this.db
            .insert(userPreferences)
            .values({ userId, functionModelsJson: "{}", createdAt: now, updatedAt: now })
            .onConflictDoNothing();
    }
}
