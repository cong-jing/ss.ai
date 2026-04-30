import type { Character, CharacterStatus } from "./character.js";

/**
 * Persistence interface for Character records.
 *
 * The core persona-flow layer only defines this interface.
 * Concrete implementations (SQLite, in-memory, cloud, …) live in adapter packages.
 * This file must NOT import SQLite, Drizzle, or any database driver.
 */
export interface CharacterStore {
    /**
     * Insert a new character.
     * The caller is responsible for setting id, createdAt, and updatedAt.
     */
    createCharacter(character: Character): Promise<void>;

    /**
     * Fetch a single character by its id.
     * Returns null when the id does not exist.
     */
    getCharacterById(id: string): Promise<Character | null>;

    /**
     * List characters, optionally filtered by status.
     * Results are sorted by updatedAt DESC.
     * @param input.status  Filter to "active" or "archived". Defaults to all statuses.
     * @param input.limit   Maximum number of results. Defaults to 50.
     */
    listCharacters(input?: {
        status?: CharacterStatus;
        limit?: number;
    }): Promise<Character[]>;

    /**
     * Apply a partial update to an existing character.
     * id and createdAt are immutable and cannot be patched.
     * The caller should set patch.updatedAt to the current timestamp.
     */
    updateCharacter(input: {
        id: string;
        patch: Partial<Omit<Character, "id" | "createdAt">>;
    }): Promise<void>;

    /**
     * Soft-delete: set the character's status to "archived".
     * Prefer archiving over hard deletion so historical references remain valid.
     */
    archiveCharacter(input: {
        id: string;
        updatedAt: string;
    }): Promise<void>;
}
