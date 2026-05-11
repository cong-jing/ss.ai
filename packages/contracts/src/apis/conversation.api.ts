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

// ── Actors (Conversation Participants) ──────────────────────────────────────

export type ConversationActorSourceType = "ai_character" | "system" | "logged_user" | "local_actor";

export interface ConversationActor {
    id: string;
    conversationId: string;
    displayName: string;
    sourceType: ConversationActorSourceType;
    userProfileId: string | null;
    characterId: string | null;
    profileSnapshotJson: string | null;
    leftAt: string | null;
    createdAt: string;
    updatedAt: string;
}

export interface ListConversationActorsResponse {
    actors: ConversationActor[];
}

/** GET /v1/conversations/:id/actors — list active actors in a conversation. */
export const ApiListConversationActors = new ApiDefine<void, ListConversationActorsResponse>(
    "/v1/conversations/:id/actors",
    "GET",
);

export interface CreateConversationActorRequest {
    displayName: string;
    profileSnapshotJson?: string | null;
}

export interface CreateConversationActorResponse {
    actor: ConversationActor;
}

/** POST /v1/conversations/:id/actors — create a local actor in a conversation. */
export const ApiCreateConversationActor = new ApiDefine<CreateConversationActorRequest, CreateConversationActorResponse>(
    "/v1/conversations/:id/actors",
    "POST",
);

export interface UpdateConversationActorRequest {
    displayName?: string;
    profileSnapshotJson?: string | null;
}

export interface UpdateConversationActorResponse {
    actor: ConversationActor;
}

/** PATCH /v1/conversations/:id/actors/:actorId — update a local actor. */
export const ApiUpdateConversationActor = new ApiDefine<UpdateConversationActorRequest, UpdateConversationActorResponse>(
    "/v1/conversations/:id/actors/:actorId",
    "PATCH",
);

export interface DeleteConversationActorResponse {
    actorId: string;
}

/** DELETE /v1/conversations/:id/actors/:actorId — remove (leave) a local/logged actor. */
export const ApiDeleteConversationActor = new ApiDefine<void, DeleteConversationActorResponse>(
    "/v1/conversations/:id/actors/:actorId",
    "DELETE",
);

// ── Messages ──────────────────────────────────────────────────────────────────

export interface ConversationMessage {
    id: string;
    role: "user" | "assistant";
    senderActorId: string;
    senderDisplayName: string;
    senderSourceType: ConversationActorSourceType;
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

export interface DeleteMessageResponse {
    messageId: string;
}

/** DELETE /v1/conversations/:id/messages/:messageId — delete a single message. */
export const ApiDeleteMessage = new ApiDefine<void, DeleteMessageResponse>(
    "/v1/conversations/:id/messages/:messageId",
    "DELETE",
);
