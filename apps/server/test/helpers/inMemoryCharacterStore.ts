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

    async getCharacterById(id: string): Promise<Character | null> {
        return this.store.get(id) ?? null;
    }

    async listCharacters(input?: {
        status?: CharacterStatus;
        limit?: number;
    }): Promise<Character[]> {
        const limit = input?.limit ?? 50;
        const results = [...this.store.values()]
            .filter(c => input?.status ? c.status === input.status : true)
            .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
            .slice(0, limit);
        return results;
    }

    async updateCharacter(input: {
        id: string;
        patch: Partial<Omit<Character, "id" | "createdAt">>;
    }): Promise<void> {
        const existing = this.store.get(input.id);
        if (!existing) return;
        this.store.set(input.id, { ...existing, ...input.patch });
    }

    async archiveCharacter(input: { id: string; updatedAt: string }): Promise<void> {
        const existing = this.store.get(input.id);
        if (!existing) return;
        this.store.set(input.id, { ...existing, status: "archived", updatedAt: input.updatedAt });
    }
}
