import {
    ApiGetUserInfo,
    ApiUpsertUserInfo,
    ApiListCharacters,
    ApiCreateCharacter,
    ApiGetActiveCharacter,
    ApiSetActiveCharacter,
} from "@ss-ai/contracts";
import type { Character, ListCharactersResponse } from "@ss-ai/contracts";
import { callApi } from "../../shared/api/httpClient";
import type { UserInfo } from "./scenarioTypes";

// ── User ─────────────────────────────────────────────────────────────────────

export async function apiGetUserInfo(): Promise<UserInfo> {
    return callApi(ApiGetUserInfo);
}

export async function apiSaveUserInfo(info: UserInfo): Promise<UserInfo> {
    return callApi(ApiUpsertUserInfo, { name: info.name, bio: info.bio });
}

// ── Character CRUD ────────────────────────────────────────────────────────────

export async function apiListCharacters(): Promise<ListCharactersResponse> {
    return callApi(ApiListCharacters);
}

export async function apiCreateCharacter(
    name: string,
    description = "",
    personaPrompt = "",
    greetingMessage?: string,
): Promise<Character> {
    return callApi(ApiCreateCharacter, { name, description, personaPrompt, greetingMessage });
}

export async function apiUpdateCharacter(
    id: string,
    patch: { name?: string; description?: string; personaPrompt?: string; greetingMessage?: string }
): Promise<Character> {
    const res = await fetch(`/v1/characters/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
    });
    if (!res.ok) {
        const err = await res.json() as { message?: string };
        throw new Error(err.message ?? `Request failed: ${res.status}`);
    }
    return res.json() as Promise<Character>;
}

export async function apiDeleteCharacter(id: string): Promise<void> {
    const res = await fetch(`/v1/characters/${encodeURIComponent(id)}`, { method: "DELETE" });
    if (!res.ok && res.status !== 204) {
        const err = await res.json() as { message?: string };
        throw new Error(err.message ?? `Request failed: ${res.status}`);
    }
}

// ── Active character ──────────────────────────────────────────────────────────

export async function apiGetActiveCharacterId(): Promise<string | null> {
    const res = await callApi(ApiGetActiveCharacter);
    return res.characterId;
}

export async function apiSetActiveCharacter(characterId: string): Promise<Character> {
    return callApi(ApiSetActiveCharacter, { characterId });
}

