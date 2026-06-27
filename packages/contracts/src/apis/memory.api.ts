import { ApiDefine } from "../apiBase.js";
import type { MemoryCandidateType, MemoryScope } from "../memoryCandidates.js";

// ── Lifecycle unions (mirrored from persona-flow domain) ─────────────────────

/**
 * Lifecycle status of a memory candidate row. Mirrors
 * `MEMORY_CANDIDATE_STATUSES` in `@ss-ai/persona-flow` and is
 * redeclared here so the HTTP contract stays self-contained (no
 * runtime dep from contracts back into persona-flow).
 */
export type MemoryCandidateStatus =
    | "pending"
    | "embedded"
    | "committed"
    | "ignored_duplicate"
    | "ignored_low_value"
    | "needs_judge"
    | "embedding_failed"
    | "commit_failed";

export type MemoryStatus = "active" | "archived";

export type MemoryDecisionKind =
    | "create"
    | "ignore_duplicate"
    | "ignore_low_value"
    | "needs_judge"
    | "embedding_failed"
    | "error";

// ── Embedding signature (no vector — debug API never ships raw vectors) ──────

/**
 * Embedding metadata without the raw vector. Vectors can be
 * thousands of floats each; for a debug listing they would dominate
 * the response payload without adding actionable information, so we
 * only expose the signature here. A future "show vector for one
 * memory" detail endpoint can include `vector` if/when needed.
 */
export interface MemoryEmbeddingSignature {
    provider: string;
    model: string;
    dim: number;
    version: number;
    createdAt: string;
}

// ── Domain projections ──────────────────────────────────────────────────────

export interface MemoryCandidateInfo {
    id: string;
    userId: string;
    characterId: string;
    conversationId: string;
    userMessageId: string;
    assistantMessageId: string;
    requestId: string;
    modelCallPurpose: string;
    seq: number;
    scope: MemoryScope;
    type: MemoryCandidateType;
    text: string;
    normalizedText: string;
    relatedEntities: string[];
    tags: string[];
    reason: string | null;
    status: MemoryCandidateStatus;
    embedding: MemoryEmbeddingSignature | null;
    schemaVersion: number;
    createdAt: string;
    updatedAt: string;
}

export interface ActiveMemoryInfo {
    id: string;
    userId: string;
    characterId: string;
    scope: MemoryScope;
    type: MemoryCandidateType;
    text: string;
    normalizedText: string;
    relatedEntities: string[];
    tags: string[];
    sourceCandidateId: string | null;
    sourceConversationId: string | null;
    sourceUserMessageId: string | null;
    sourceAssistantMessageId: string | null;
    status: MemoryStatus;
    importance: number;
    embedding: MemoryEmbeddingSignature | null;
    schemaVersion: number;
    createdAt: string;
    updatedAt: string;
}

export interface MemorySimilarityEntry {
    memoryId: string;
    similarity: number;
    text: string;
}

export interface MemoryDecisionInfo {
    id: string;
    candidateId: string;
    userId: string;
    characterId: string;
    decision: MemoryDecisionKind;
    memoryId: string | null;
    reason: string | null;
    similarity: MemorySimilarityEntry[];
    policyVersion: number;
    createdAt: string;
}

// ── Request / response shapes ───────────────────────────────────────────────

/**
 * Filters for `ApiListMemoryCandidates`. All filters are optional;
 * `userId` is never accepted from the client — the server forces it
 * to the authenticated user.
 *
 * Multi-value filters (`status`) accept either a repeated query
 * param (`?status=pending&status=embedded`) or a comma-separated
 * list (`?status=pending,embedded`).
 */
export interface ListMemoryCandidatesRequest {
    characterId?: string;
    conversationId?: string;
    assistantMessageId?: string;
    status?: MemoryCandidateStatus | MemoryCandidateStatus[];
    /** Default 100, hard max 500. Out-of-range values are clamped. */
    limit?: number;
}

export interface ListMemoryCandidatesResponse {
    candidates: MemoryCandidateInfo[];
}

/**
 * Filters for `ApiListMemories`. `characterId` is required because
 * every memory belongs to exactly one character world; a scan that
 * omitted it would have to fall back to "all characters for this
 * user", which is intentionally not supported through this debug
 * surface (use multiple requests instead).
 */
export interface ListMemoriesRequest {
    characterId: string;
    scope?: MemoryScope | MemoryScope[];
    type?: MemoryCandidateType | MemoryCandidateType[];
    status?: MemoryStatus | MemoryStatus[];
    /** Default 100, hard max 500. Out-of-range values are clamped. */
    limit?: number;
}

export interface ListMemoriesResponse {
    memories: ActiveMemoryInfo[];
}

/**
 * Filters for `ApiListMemoryDecisions`. `characterId` is optional
 * so admin views can show the whole user history if needed, but
 * passing it lets a debug page show "decisions inside character X's
 * world" without manual post-filtering.
 */
export interface ListMemoryDecisionsRequest {
    characterId?: string;
    candidateId?: string;
    decision?: MemoryDecisionKind | MemoryDecisionKind[];
    /** Default 100, hard max 500. Out-of-range values are clamped. */
    limit?: number;
}

export interface ListMemoryDecisionsResponse {
    decisions: MemoryDecisionInfo[];
}

// ── Endpoints ────────────────────────────────────────────────────────────────

/** GET /v1/debug/memory-candidates — list candidate rows for the current user. */
export const ApiListMemoryCandidates =
    new ApiDefine<ListMemoryCandidatesRequest, ListMemoryCandidatesResponse>(
        "/v1/debug/memory-candidates",
        "GET",
    );

/** GET /v1/debug/memories — list active memories for the current user + character. */
export const ApiListMemories =
    new ApiDefine<ListMemoriesRequest, ListMemoriesResponse>(
        "/v1/debug/memories",
        "GET",
    );

/** GET /v1/debug/memory-decisions — list commit decisions for the current user. */
export const ApiListMemoryDecisions =
    new ApiDefine<ListMemoryDecisionsRequest, ListMemoryDecisionsResponse>(
        "/v1/debug/memory-decisions",
        "GET",
    );
