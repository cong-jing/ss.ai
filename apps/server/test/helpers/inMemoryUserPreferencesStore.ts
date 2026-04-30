import type { ModelSelection, UserPreferences, UserPreferencesStore } from "@ss-ai/persona-flow";

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

    async setCurrentConversation(input: { userId: string; conversationId: string | null; updatedAt: string }): Promise<void> {
        const p = this.store.get(input.userId) ?? this.#defaultPrefs(input.userId);
        this.store.set(input.userId, { ...p, currentConversationId: input.conversationId, updatedAt: input.updatedAt });
    }

    async setFunctionModel(input: { userId: string; functionName: string; selection: ModelSelection; updatedAt: string }): Promise<void> {
        const p = this.store.get(input.userId) ?? this.#defaultPrefs(input.userId);
        this.store.set(input.userId, {
            ...p,
            functionModels: { ...p.functionModels, [input.functionName]: input.selection },
            updatedAt: input.updatedAt,
        });
    }

    #defaultPrefs(userId: string): UserPreferences {
        const now = new Date().toISOString();
        return { userId, functionModels: {}, createdAt: now, updatedAt: now };
    }
}
