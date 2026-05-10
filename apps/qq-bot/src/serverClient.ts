import type {
    ListCharactersResponse,
    ListConversationsResponse,
    CreateConversationResponse,
    SelectConversationResponse,
    ChatResponse,
} from "@ss-ai/contracts";

const SERVER_URL = process.env.SERVER_URL ?? "http://127.0.0.1:8999";

async function apiFetch<T>(path: string, method: string, body?: unknown): Promise<T> {
    const res = await fetch(`${SERVER_URL}${path}`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: body != null ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`API ${method} ${path} failed (${res.status}): ${text}`);
    }
    // DELETE with no content
    if (res.status === 204) return undefined as T;
    return res.json() as Promise<T>;
}

/** Get all characters and the active character id. */
export async function listCharacters(): Promise<ListCharactersResponse> {
    return apiFetch<ListCharactersResponse>("/v1/characters", "GET");
}

/** Get the currently active character id (null if none). */
export async function getActiveCharacterId(): Promise<string | null> {
    const { activeCharacterId } = await listCharacters();
    return activeCharacterId;
}

/** List conversations for a character. */
export async function listConversations(characterId: string): Promise<ListConversationsResponse> {
    return apiFetch<ListConversationsResponse>(`/v1/characters/${characterId}/conversations`, "GET");
}

/** Create a new conversation for a character and return its id. */
export async function createConversation(characterId: string): Promise<string> {
    const res = await apiFetch<CreateConversationResponse>(
        `/v1/characters/${characterId}/conversations`,
        "POST",
    );
    return res.conversationId;
}

/** Switch the active conversation for a character. */
export async function selectConversation(
    characterId: string,
    conversationId: string,
): Promise<SelectConversationResponse> {
    return apiFetch<SelectConversationResponse>(
        `/v1/characters/${characterId}/active-conversation`,
        "POST",
        { conversationId },
    );
}

/** Send a chat message and return the text reply. */
export async function chat(characterId: string, prompt: string): Promise<string> {
    const res = await apiFetch<ChatResponse>("/v1/chat", "POST", { characterId, prompt });
    return res.output;
}
