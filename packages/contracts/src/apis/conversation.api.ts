import { ApiDefine } from "../apiBase.js";

// ── Shared projection ──────────────────────────────────────────────────────────

/** Public projection of a Conversation record (no userId). */
export interface ConversationInfo {
    id: string;
    title: string | null;
    createdAt: string;
    updatedAt: string;
}

// ── List ───────────────────────────────────────────────────────────────────────

export interface ListConversationsResponse {
    conversations: ConversationInfo[];
    /** Currently active conversationId for this character (null if none). */
    activeConversationId: string | null;
}

/** GET /v1/characters/:id/conversations — list all conversations for a character. */
export const ApiListConversations = new ApiDefine<void, ListConversationsResponse>(
    "/v1/characters/:id/conversations",
    "GET",
);

// ── Create ────────────────────────────────────────────────────────────────────

export interface CreateConversationResponse {
    /** The newly created conversationId (now active). */
    conversationId: string;
    /** Updated list of all conversations, newest first. */
    conversations: ConversationInfo[];
    activeConversationId: string;
}

/** POST /v1/characters/:id/conversations — create a new conversation and switch to it. */
export const ApiCreateConversation = new ApiDefine<void, CreateConversationResponse>(
    "/v1/characters/:id/conversations",
    "POST",
);

// ── Select (switch to) ────────────────────────────────────────────────────────

export interface SelectConversationRequest {
    conversationId: string;
}

export interface SelectConversationResponse {
    conversationId: string;
    conversations: ConversationInfo[];
}

/** POST /v1/characters/:id/active-conversation — switch to an existing conversation. */
export const ApiSelectConversation = new ApiDefine<SelectConversationRequest, SelectConversationResponse>(
    "/v1/characters/:id/active-conversation",
    "POST",
);

// ── Delete ────────────────────────────────────────────────────────────────────

export interface DeleteConversationResponse {
    /** Updated list of conversations after deletion, newest first. */
    conversations: ConversationInfo[];
    /** The now-active conversationId (may differ if the deleted one was active). */
    activeConversationId: string | null;
}

/**
 * DELETE /v1/characters/:id/conversations/:convId — delete a conversation and its messages.
 * If the deleted conversation was active, the server auto-switches to the newest remaining
 * one (or auto-creates a new one if none remain).
 */
export const ApiDeleteConversation = new ApiDefine<void, DeleteConversationResponse>(
    "/v1/characters/:id/conversations/:convId",
    "DELETE",
);

// ── Messages ──────────────────────────────────────────────────────────────────

export interface ConversationMessage {
    id: string;
    role: "user" | "assistant";
    content: string;
    createdAt: string;
}

export interface GetMessagesResponse {
    messages: ConversationMessage[];
}

/** GET /v1/conversations/:id/messages — fetch recent messages for a conversation. */
export const ApiGetMessages = new ApiDefine<void, GetMessagesResponse>(
    "/v1/conversations/:id/messages",
    "GET",
);
