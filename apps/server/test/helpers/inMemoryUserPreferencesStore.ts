import type { ModelAssignment, ModelCallPurpose } from "@ss-ai/contracts";
import type { UserPreferences, UserPreferencesStore } from "@ss-ai/persona-flow";

export class InMemoryUserPreferencesStore implements UserPreferencesStore {
    private readonly store = new Map<string, UserPreferences>();

    async getUserPreferences(userId: string): Promise<UserPreferences | null> {
        return this.store.get(userId) ?? null;
    }

    async upsertUserPreferences(preferences: UserPreferences): Promise<void> {
        this.store.set(preferences.userId, { ...preferences });
    }

    async setCurrentCharacter(input: { userId: string; characterId: string | null; updatedAt: string }): Promise<void> {
        const p = this.store.get(input.userId) ?? this.#defaultPrefs(input.userId);
        this.store.set(input.userId, { ...p, currentCharacterId: input.characterId, updatedAt: input.updatedAt });
    }

    async setModelAssignment(input: { userId: string; modelCallPurpose: ModelCallPurpose; assignment: ModelAssignment; updatedAt: string }): Promise<void> {
        const p = this.store.get(input.userId) ?? this.#defaultPrefs(input.userId);
        this.store.set(input.userId, {
            ...p,
            modelAssignments: { ...p.modelAssignments, [input.modelCallPurpose]: input.assignment },
            updatedAt: input.updatedAt,
        });
    }

    #defaultPrefs(userId: string): UserPreferences {
        const now = new Date().toISOString();
        return { userId, modelAssignments: {}, createdAt: now, updatedAt: now };
    }
}
