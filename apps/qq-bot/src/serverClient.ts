import type {
    Character,
    ListCharactersResponse,
    ListConversationsResponse,
    CreateConversationResponse,
    CreateConversationActorResponse,
    ChatResponse,
} from "@ss-ai/contracts";
import { log } from "./logger.js";

function getServerUrl(): string {
    return process.env.CHAT_SERVER_URL
        ?? process.env.SERVER_URL
        ?? "http://127.0.0.1:8999";
}

function isDryRunMode(): boolean {
    const value = process.env.QQ_BOT_DRY_RUN?.trim().toLowerCase();
    return value === "1" || value === "true" || value === "yes" || value === "on";
}

function createMockCharacter(): Character {
    const configuredName = process.env.CHARACTER_NAME?.trim();
    const now = new Date().toISOString();
    return {
        id: "dry-run-character-id",
        name: configuredName || "dry-run-character",
        displayName: configuredName || "dry-run-character",
        description: "",
        personaPrompt: "",
        greetingMessage: null,
        modelConfig: {},
        status: "active",
        createdAt: now,
        updatedAt: now,
    };
}

function mockApiResponse<T>(path: string, method: string, body?: unknown): T {
    if (method === "GET" && path === "/v1/characters") {
        return {
            characters: [createMockCharacter()],
            activeCharacterId: "dry-run-character-id",
        } as T;
    }

    if (method === "GET" && /\/v1\/characters\/[^/]+\/conversations$/.test(path)) {
        return {
            conversations: [],
            activeConversationId: null,
        } as T;
    }

    if (method === "POST" && /\/v1\/characters\/[^/]+\/conversations$/.test(path)) {
        const conversationId = `dry-run-conversation-${Date.now()}`;
        return {
            conversationId,
            conversations: [],
            activeConversationId: conversationId,
        } as T;
    }

    if (method === "POST" && /\/v1\/conversations\/[^/]+\/actors$/.test(path)) {
        const payload = (body ?? {}) as { displayName?: string };
        const now = new Date().toISOString();
        const conversationId = path.split("/")[3] ?? "dry-run-conversation-id";
        return {
            actor: {
                id: `dry-run-actor-${Date.now()}`,
                conversationId,
                displayName: payload.displayName ?? "dry-run-actor",
                sourceType: "local_actor",
                userProfileId: null,
                characterId: null,
                profileSnapshotJson: null,
                leftAt: null,
                createdAt: now,
                updatedAt: now,
            },
        } as T;
    }

    if (method === "POST" && path === "/v1/chat") {
        const payload = (body ?? {}) as { userMessageText?: string };
        return {
            output: `[dry-run] ${payload.userMessageText ?? ""}`,
            model: "dry-run-model",
            requestId: `dry-run-request-${Date.now()}`,
        } as T;
    }

    return {} as T;
}

async function apiFetch<T>(path: string, method: string, body?: unknown): Promise<T> {
    if (isDryRunMode()) {
        log("[bot][dry-run] would call server api", {
            baseUrl: getServerUrl(),
            method,
            path,
            body: body ?? null,
        });
        return mockApiResponse<T>(path, method, body);
    }

    const res = await fetch(`${getServerUrl()}${path}`, {
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

/** Resolve a character by exact name and return match diagnostics. */
export async function findCharacterByName(name: string): Promise<{
    matches: Character[];
    activeCharacterId: string | null;
}> {
    const { characters, activeCharacterId } = await listCharacters();
    const matches = characters.filter(character => character.name === name);
    return { matches, activeCharacterId };
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

/** Create a local actor in a conversation and return its id. */
export async function createLocalActor(
    conversationId: string,
    displayName: string,
    profileSnapshotJson?: string | null,
): Promise<string> {
    const res = await apiFetch<CreateConversationActorResponse>(
        `/v1/conversations/${conversationId}/actors`,
        "POST",
        {
            displayName,
            ...(profileSnapshotJson !== undefined ? { profileSnapshotJson } : {}),
        },
    );
    return res.actor.id;
}

/** Send a chat message and return the text reply. */
export async function chat(
    characterId: string,
    conversationId: string,
    userMessageText: string,
    senderActorId?: string,
): Promise<string | null> {
    const res = await apiFetch<ChatResponse>("/v1/chat", "POST", {
        characterId,
        conversationId,
        userMessageText,
        llmResponseMode: "structured",
        ...(senderActorId ? { senderActorId } : {}),
    });

    if (res.structuredOutput?.action === "skip") {
        return null;
    }

    if (res.structuredOutput?.replyText?.trim()) {
        return res.structuredOutput.replyText;
    }

    return res.output;
}
