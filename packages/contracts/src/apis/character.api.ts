import { ApiDefine } from "../apiBase.js";
import type { InteractionMode } from "../interactionMode.js";
import type { ModelAssignmentMap } from "../modelCallPurpose.js";
import type { ConversationInfo } from "./conversation.api.js";

export type PromptLanguage = "zh-CN" | "en-US" | "ja-JP";
// ── Domain type ────────────────────────────────────────────────────────────────

/** Per-purpose model overrides. Absent key = inherit from user preference. */
export type CharacterModelConfig = ModelAssignmentMap;

/**
 * HTTP API projection of a character card.
 * Internal-only fields (displayName, avatarUrl) are excluded.
 */
export interface Character {
    id: string;
    name: string;
    displayName: string | null;
    description: string;
    personaPrompt: string;
    greetingMessage: string | null;
    modelConfig: CharacterModelConfig;
    interactionMode: InteractionMode;
    language: PromptLanguage;
    status: "active" | "archived";
    createdAt: string;
    updatedAt: string;
}

// ── Request / Response shapes ──────────────────────────────────────────────────

export interface CreateCharacterRequest {
    name: string;
    displayName?: string;
    description?: string;
    personaPrompt?: string;
    greetingMessage?: string;
    interactionMode?: InteractionMode;
    language?: PromptLanguage;
}

export interface UpdateCharacterRequest {
    name?: string;
    displayName?: string;
    description?: string;
    personaPrompt?: string;
    greetingMessage?: string;
    language?: PromptLanguage;
    /** Full replacement of modelConfig. Absent keys inherit from user preference. */
    modelConfig?: CharacterModelConfig;
}

export interface CharacterTemplate {
    id: string;
    name: string;
    displayName: string | null;
    description: string;
    personaPrompt: string;
    greetingMessage: string | null;
    interactionMode: InteractionMode;
    language: PromptLanguage;
}

export interface ListCharacterTemplatesRequest {
    language?: PromptLanguage;
}

export interface ListCharacterTemplatesResponse {
    templates: CharacterTemplate[];
}

export interface ListCharactersResponse {
    characters: Character[];
    /** null when no character has been selected yet. */
    activeCharacterId: string | null;
}

export interface InteractionModesResponse {
    interactionModes: InteractionMode[];
}

// ── API endpoints ──────────────────────────────────────────────────────────────

/** GET /v1/characters — list active characters + currently active characterId */
export const ApiListCharacters = new ApiDefine<void, ListCharactersResponse>("/v1/characters", "GET");

/** POST /v1/characters — create a new character */
export const ApiCreateCharacter = new ApiDefine<CreateCharacterRequest, Character>("/v1/characters", "POST");

/**
 * GET /v1/characters/:id — get one character.
 * The `:id` segment is a URL template; replace it with the actual id when calling.
 */
export const ApiGetCharacter = new ApiDefine<void, Character>("/v1/characters/:id", "GET");

/**
 * PATCH /v1/characters/:id — update name / description.
 * The `:id` segment is a URL template; replace it with the actual id when calling.
 */
export const ApiUpdateCharacter = new ApiDefine<UpdateCharacterRequest, Character>("/v1/characters/:id", "PATCH");

/**
 * DELETE /v1/characters/:id — remove a character.
 * The `:id` segment is a URL template; replace it with the actual id when calling.
 */
export const ApiDeleteCharacter = new ApiDefine<void, void>("/v1/characters/:id", "DELETE");

/** GET /v1/character-interaction-modes — list selectable interaction modes for character cards. */
export const ApiListCharacterInteractionModes = new ApiDefine<void, InteractionModesResponse>("/v1/character-interaction-modes", "GET");
export const ApiListCharacterTemplates = new ApiDefine<ListCharacterTemplatesRequest, ListCharacterTemplatesResponse>("/v1/character-templates", "GET");

// ── Active character ───────────────────────────────────────────────────────────

export interface ActiveCharacterResponse {
    /** null when no character has been selected yet. */
    characterId: string | null;
}

export interface SetActiveCharacterRequest {
    characterId: string;
}

export interface SetActiveCharacterResponse {
    character: Character;
    /** All conversations for this character, newest first. */
    conversations: ConversationInfo[];
    /** Currently active conversationId (null if none). */
    activeConversationId: string | null;
}

/** GET /v1/active-character — returns the currently active characterId (may be null). */
export const ApiGetActiveCharacter = new ApiDefine<void, ActiveCharacterResponse>("/v1/active-character", "GET");

/** POST /v1/active-character — set the active character; returns character + conversations. */
export const ApiSetActiveCharacter = new ApiDefine<SetActiveCharacterRequest, SetActiveCharacterResponse>("/v1/active-character", "POST");
