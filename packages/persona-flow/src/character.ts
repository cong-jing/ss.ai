export type CharacterStatus = "active" | "archived";

/**
 * Character domain model — the "character card".
 *
 * Scope: identity, persona, and generation configuration.
 * NOT included here: user↔character relationship state, long-term memory,
 * chat history, or per-conversation data.  Those belong in separate tables
 * (relationship_state, memory_items, messages, conversations, …).
 */
export type Character = {
    /** Unique character ID, e.g. "char_rinrin". */
    id: string;

    /** Internal / canonical name, e.g. "Rinrin". */
    name: string;

    /** Display name shown in UI, e.g. "凛凛". May be null if same as name. */
    displayName?: string | null;

    /** Short description, used in UI and optionally in prompt assembly. */
    description?: string | null;

    /**
     * Core persona prompt.
     * Describes the character's personality, speech style, self-perception,
     * and interaction style with the user.
     */
    personaPrompt: string;

    /** Default greeting for a new conversation. */
    greetingMessage?: string | null;

    /** Avatar image path or URL. null means no avatar configured. */
    avatarUrl?: string | null;

    /**
     * Model selection config.
     * Example: { provider: "mistral", model: "mistral-large-latest" }
     * Kept as a loose Record so different providers can add their own keys
     * without requiring a schema migration.
     */
    modelConfig: Record<string, unknown>;

    /**
     * LLM generation parameters.
     * Example: { temperature: 0.8, maxTokens: 1200, topP: 1 }
     */
    generationConfig: Record<string, unknown>;

    /**
     * Memory strategy config.
     * Example: { recentMessageLimit: 20, enableMemorySearch: true, memorySearchLimit: 8 }
     */
    memoryConfig: Record<string, unknown>;

    /** Lifecycle status. Use "archived" instead of hard-deleting a character. */
    status: CharacterStatus;

    /** ISO 8601 creation timestamp. */
    createdAt: string;

    /** ISO 8601 last-updated timestamp. */
    updatedAt: string;
};
