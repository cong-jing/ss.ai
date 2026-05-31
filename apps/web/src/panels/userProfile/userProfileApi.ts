import {
    ApiGetUserProfile,
    ApiUpsertUserProfile,
    ApiListCharacters,
    ApiCreateCharacter,
    ApiGetActiveCharacter,
    ApiSetActiveCharacter,
    ApiListCharacterInteractionModes,
} from "@ss-ai/contracts";
import type {
    Character,
    CharacterModelConfig,
    InteractionModesResponse,
    ListCharactersResponse,
    SetActiveCharacterResponse,
    ListConversationsResponse,
    CreateConversationResponse,
    SelectConversationResponse,
    DeleteConversationResponse,
} from "@ss-ai/contracts";
import { callApi } from "../../shared/api/httpClient";
import { throwApiRequestError } from "../../shared/api/throwApiRequestError";
import type { UserProfileInfo } from "./userProfileTypes";

export async function apiGetUserProfileInfo(): Promise<UserProfileInfo> {
    return callApi(ApiGetUserProfile);
}

export async function apiSaveUserProfileInfo(info: UserProfileInfo): Promise<UserProfileInfo> {
    return callApi(ApiUpsertUserProfile, { name: info.name, bio: info.bio });
}

export async function apiListCharacters(): Promise<ListCharactersResponse> {
    return callApi(ApiListCharacters);
}

export async function apiListCharacterInteractionModes(): Promise<InteractionModesResponse> {
    return callApi(ApiListCharacterInteractionModes);
}

export async function apiCreateCharacter(
    name: string,
    displayName = "",
    description = "",
    personaPrompt = "",
    greetingMessage?: string,
    interactionMode?: Character["interactionMode"],
): Promise<Character> {
    return callApi(ApiCreateCharacter, { name, displayName, description, personaPrompt, greetingMessage, interactionMode });
}

export async function apiUpdateCharacter(
    id: string,
    patch: { name?: string; displayName?: string; description?: string; personaPrompt?: string; greetingMessage?: string; interactionMode?: Character["interactionMode"]; modelConfig?: CharacterModelConfig },
): Promise<Character> {
    const res = await fetch(`/v1/characters/${encodeURIComponent(id)}`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
    });
    if (!res.ok) {
        await throwApiRequestError(res);
    }
    return res.json() as Promise<Character>;
}

export async function apiDeleteCharacter(id: string): Promise<void> {
    const res = await fetch(`/v1/characters/${encodeURIComponent(id)}`, { method: "DELETE", credentials: "same-origin" });
    if (!res.ok && res.status !== 204) {
        await throwApiRequestError(res);
    }
}

export async function apiGetActiveCharacter() {
    return callApi(ApiGetActiveCharacter);
}

export async function apiSetActiveCharacter(id: string): Promise<SetActiveCharacterResponse> {
    return callApi(ApiSetActiveCharacter, { characterId: id });
}

export async function apiListConversations(characterId: string): Promise<ListConversationsResponse> {
    const res = await fetch(`/v1/characters/${encodeURIComponent(characterId)}/conversations`, {
        credentials: "same-origin",
    });
    if (!res.ok) {
        await throwApiRequestError(res);
    }
    return res.json() as Promise<ListConversationsResponse>;
}

export async function apiCreateConversation(characterId: string): Promise<CreateConversationResponse> {
    const res = await fetch(`/v1/characters/${encodeURIComponent(characterId)}/conversations`, {
        method: "POST",
        credentials: "same-origin",
    });
    if (!res.ok) {
        await throwApiRequestError(res);
    }
    return res.json() as Promise<CreateConversationResponse>;
}

export async function apiSelectConversation(characterId: string, conversationId: string): Promise<SelectConversationResponse> {
    const res = await fetch(`/v1/characters/${encodeURIComponent(characterId)}/active-conversation`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId }),
    });
    if (!res.ok) {
        await throwApiRequestError(res);
    }
    return res.json() as Promise<SelectConversationResponse>;
}

export async function apiDeleteConversation(characterId: string, conversationId: string): Promise<DeleteConversationResponse> {
    const res = await fetch(
        `/v1/characters/${encodeURIComponent(characterId)}/conversations/${encodeURIComponent(conversationId)}`,
        { method: "DELETE", credentials: "same-origin" },
    );
    if (!res.ok) {
        await throwApiRequestError(res);
    }
    return res.json() as Promise<DeleteConversationResponse>;
}
