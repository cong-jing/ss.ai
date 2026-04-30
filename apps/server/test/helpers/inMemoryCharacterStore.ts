/**
 * A simple in-memory implementation of CharacterStore for use in server tests.
 *
 * This avoids any SQLite dependency in server-layer tests — SQLiteCharacterStore
 * has its own comprehensive tests in packages/persona-flow-sqlite.
 */
import type { Character, CharacterStatus, CharacterStore } from "@ss-ai/persona-flow";

export class InMemoryCharacterStore implements CharacterStore {
    private readonly store = new Map<string, Character>();

    async createCharacter(character: Character): Promise<void> {
        this.store.set(character.id, { ...character });
    }

    async getCharacterById(input: { userId: string; characterId: string }): Promise<Character | null> {
        const c = this.store.get(input.characterId);
        return c && c.userId === input.userId ? c : null;
    }

    async listCharacters(input: { userId: string; status?: CharacterStatus; limit?: number }): Promise<Character[]> {
        const limit = input.limit ?? 50;
        const results = [...this.store.values()]
            .filter(c => c.userId === input.userId)
            .filter(c => input.status ? c.status === input.status : c.status !== "archived")
            .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
            .slice(0, limit);
        return results;
    }

    async updateCharacter(input: {
        userId: string;
        characterId: string;
        patch: Partial<Omit<Character, "id" | "userId" | "createdAt">>;
    }): Promise<void> {
        const existing = this.store.get(input.characterId);
        if (!existing || existing.userId !== input.userId) return;
        this.store.set(input.characterId, { ...existing, ...input.patch });
    }

    async archiveCharacter(input: { userId: string; characterId: string; updatedAt: string }): Promise<void> {
        const existing = this.store.get(input.characterId);
        if (!existing || existing.userId !== input.userId) return;
        this.store.set(input.characterId, { ...existing, status: "archived", updatedAt: input.updatedAt });
    }
}
