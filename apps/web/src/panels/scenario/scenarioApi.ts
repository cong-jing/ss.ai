import {
    ApiGetUserProfile,
    ApiUpsertUserProfile,
    ApiListCharacters,
    ApiCreateCharacter,
    ApiGetActiveCharacter,
    ApiSetActiveCharacter,
} from "@ss-ai/contracts";
import type {
    Character,
    CharacterModelConfig,
    ListCharactersResponse,
    SetActiveCharacterResponse,
    ListConversationsResponse,
    CreateConversationResponse,
    SelectConversationResponse,
    DeleteConversationResponse,
} from "@ss-ai/contracts";
import { callApi } from "../../shared/api/httpClient";
import type { UserInfo } from "./scenarioTypes";

// ── User ─────────────────────────────────────────────────────────────────────

export async function apiGetUserInfo(): Promise<UserInfo> {
    return callApi(ApiGetUserProfile);
}

export async function apiSaveUserInfo(info: UserInfo): Promise<UserInfo> {
    return callApi(ApiUpsertUserProfile, { name: info.name, bio: info.bio });
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
    patch: { name?: string; description?: string; personaPrompt?: string; greetingMessage?: string; modelConfig?: CharacterModelConfig }
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

export async function apiGetActiveCharacter() {
    return callApi(ApiGetActiveCharacter);
}

export async function apiSetActiveCharacter(id: string): Promise<SetActiveCharacterResponse> {
    return callApi(ApiSetActiveCharacter, { characterId: id });
}

// ── Conversations ─────────────────────────────────────────────────────────────

export async function apiListConversations(characterId: string): Promise<ListConversationsResponse> {
    const res = await fetch(`/v1/characters/${encodeURIComponent(characterId)}/conversations`);
    if (!res.ok) {
        const err = await res.json() as { message?: string };
        throw new Error(err.message ?? `Request failed: ${res.status}`);
    }
    return res.json() as Promise<ListConversationsResponse>;
}

export async function apiCreateConversation(characterId: string): Promise<CreateConversationResponse> {
    const res = await fetch(`/v1/characters/${encodeURIComponent(characterId)}/conversations`, {
        method: "POST",
    });
    if (!res.ok) {
        const err = await res.json() as { message?: string };
        throw new Error(err.message ?? `Request failed: ${res.status}`);
    }
    return res.json() as Promise<CreateConversationResponse>;
}

export async function apiSelectConversation(characterId: string, conversationId: string): Promise<SelectConversationResponse> {
    const res = await fetch(`/v1/characters/${encodeURIComponent(characterId)}/active-conversation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId }),
    });
    if (!res.ok) {
        const err = await res.json() as { message?: string };
        throw new Error(err.message ?? `Request failed: ${res.status}`);
    }
    return res.json() as Promise<SelectConversationResponse>;
}

export async function apiDeleteConversation(characterId: string, conversationId: string): Promise<DeleteConversationResponse> {
    const res = await fetch(
        `/v1/characters/${encodeURIComponent(characterId)}/conversations/${encodeURIComponent(conversationId)}`,
        { method: "DELETE" },
    );
    if (!res.ok) {
        const err = await res.json() as { message?: string };
        throw new Error(err.message ?? `Request failed: ${res.status}`);
    }
    return res.json() as Promise<DeleteConversationResponse>;
}

