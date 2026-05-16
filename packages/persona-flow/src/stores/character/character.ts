import type { PromptMode } from "@ss-ai/contracts";

export type CharacterStatus = "active" | "archived";
export type PromptLanguage = "zh-CN" | "ja-JP" | "en-US";

/**
 * Character domain model — the "character card".
 *
 * Scope: identity, persona, and generation configuration.
 * Each character belongs to exactly one user (via userId).
 * NOT included here: relationship state, long-term memory, or chat history.
 */
export type Character = {
    /** Unique character ID. */
    id: string;

    /** Owner user ID. */
    userId: string;

    /** Internal / canonical name, e.g. "Rinrin". */
    name: string;

    /** Display name shown in UI. May be null if same as name. */
    displayName?: string | null;

    /** Short description, used in UI and optionally in prompt assembly. */
    description?: string | null;

    /**
     * Core persona prompt.
     */
    personaPrompt: string;

    /** Default greeting for a new conversation. */
    greetingMessage?: string | null;

    /** Avatar image path or URL. null means no avatar configured. */
    avatarUrl?: string | null;

    /** Model selection config. Example: { provider: "mistral", model: "mistral-large-latest" } */
    modelConfig: Record<string, unknown>;

    /** Prompt rendering mode used when assembling prompts for this character. */
    promptMode?: PromptMode | null;

    /** LLM generation parameters. Example: { temperature: 0.8, maxTokens: 1200 } */
    generationConfig: Record<string, unknown>;

    /** Memory strategy config. Example: { recentMessageLimit: 20 } */
    memoryConfig: Record<string, unknown>;

    /** Preferred prompt language for this character (e.g. "zh-CN"). Defaults to "zh-CN" if not set. */
    language?: PromptLanguage | null;

    /** Lifecycle status. Use "archived" instead of hard-deleting. */
    status: CharacterStatus;

    /** ISO 8601 creation timestamp. */
    createdAt: string;

    /** ISO 8601 last-updated timestamp. */
    updatedAt: string;
};
