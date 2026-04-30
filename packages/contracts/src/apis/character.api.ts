import { ApiDefine } from "../apiBase.js";

// ── Domain type ────────────────────────────────────────────────────────────────

export interface Character {
    id: string;
    name: string;
    description: string;
    createdAt: string;
    updatedAt: string;
}

// ── Request / Response shapes ──────────────────────────────────────────────────

export interface CreateCharacterRequest {
    name: string;
    description?: string;
}

export interface UpdateCharacterRequest {
    name?: string;
    description?: string;
}

// ── API endpoints ──────────────────────────────────────────────────────────────

/** GET /v1/characters — list all characters */
export const ApiListCharacters = new ApiDefine<void, Character[]>("/v1/characters", "GET");

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

// ── Active character ───────────────────────────────────────────────────────────

export interface ActiveCharacterResponse {
    /** null when no character has been selected yet. */
    characterId: string | null;
}

export interface SetActiveCharacterRequest {
    characterId: string;
}

/** GET /v1/active-character — returns the currently active characterId (may be null). */
export const ApiGetActiveCharacter = new ApiDefine<void, ActiveCharacterResponse>("/v1/active-character", "GET");

/** POST /v1/active-character — set the active character; returns the full Character object. */
export const ApiSetActiveCharacter = new ApiDefine<SetActiveCharacterRequest, Character>("/v1/active-character", "POST");
