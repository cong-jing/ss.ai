import type { Character, CharacterStatus } from "./character.js";

/**
 * Persistence interface for Character records.
 * All queries are scoped to a userId so each user's characters are isolated.
 * Concrete implementations live in adapter packages.
 */
export interface CharacterStore {
    /**
     * Insert a new character.
     * The caller is responsible for setting id, userId, createdAt, and updatedAt.
     */
    createCharacter(character: Character): Promise<void>;

    /**
     * Fetch a single character by its id, scoped to a user.
     * Returns null when not found or belongs to a different user.
     */
    getCharacterById(input: { userId: string; characterId: string }): Promise<Character | null>;

    /**
     * List characters for a user, optionally filtered by status.
     * Results are sorted by updatedAt DESC.
     */
    listCharacters(input: {
        userId: string;
        status?: CharacterStatus;
        limit?: number;
    }): Promise<Character[]>;

    /**
     * Apply a partial update to an existing character, scoped to a user.
     * id, userId, and createdAt are immutable.
     * The caller should set patch.updatedAt to the current timestamp.
     */
    updateCharacter(input: {
        userId: string;
        characterId: string;
        patch: Partial<Omit<Character, "id" | "userId" | "createdAt">>;
    }): Promise<void>;

    /**
     * Soft-delete: set the character's status to "archived", scoped to a user.
     */
    archiveCharacter(input: {
        userId: string;
        characterId: string;
        updatedAt: string;
    }): Promise<void>;
}
