import { ApiDefine } from "../apiBase.js";
import type { MemoryCandidateType, MemoryScope } from "../memoryCandidates.js";

// ── Lifecycle unions (mirrored from persona-flow domain) ─────────────────────

/**
 * Lifecycle status of a memory candidate row.
 *
 * Batch 3.5 restored the candidate table to "raw candidate + processing
 * state". Once a candidate has been processed, the resulting evidence
 * lives on `memory_staging` (and eventually `memory_retained`); the
 * candidate row itself only carries an outcome status here.
 *
 * Mirrors `MEMORY_CANDIDATE_STATUSES` in `@ss-ai/persona-flow` and is
 * redeclared so the HTTP contract stays self-contained (no runtime
 * dep from contracts back into persona-flow).
 */
export type MemoryCandidateStatus =
    | "pending"
    | "processing"
    | "processed"
    | "rejected_by_rule"
    | "failed";

/**
 * Lifecycle status of a memory staging row. Batch 3.5 only writes
 * `pending` (and exceptionally `failed`). The other values are
 * reserved for later batches that introduce consolidation, archive,
 * and forget operations.
 */
export type MemoryStagingStatus =
    | "pending"
    | "processed"
    | "archived"
    | "forgotten"
    | "failed";

/**
 * Lifecycle status of a memory retained row. Batch 3.5 does not
 * persist into this table yet, but the enum is declared here so the
 * debug contract is ready when Batch 4 begins writing consolidated
 * memories.
 */
export type MemoryRetainedStatus = "active" | "archived";

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

/**
 * Projection of one candidate row for the debug surface.
 *
 * `candidateReason` is what the model gave us when it submitted the
 * candidate (intent). `statusReason` is what the pipeline decided
 * when transitioning the row (outcome). They lived together as a
 * single `reason` field before Batch 3.5; splitting them lets a
 * debug page distinguish intent from outcome without re-reading
 * prompt logs.
 *
 * `normalizedText` / `embedding` are intentionally absent: those
 * concerns now belong to `memory_staging`.
 */
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
    relatedEntities: string[];
    tags: string[];
    candidateReason: string | null;
    status: MemoryCandidateStatus;
    statusReason: string | null;
    schemaVersion: number;
    createdAt: string;
    updatedAt: string;
}

/**
 * Projection of one memory staging row. Holds candidate-aggregated
 * evidence (normalizedText, embedding signature, occurrence count)
 * but is *not* a long-term memory yet; the consolidation step that
 * produces `memory_retained` rows lives in Batch 4.
 */
export interface MemoryStagingInfo {
    id: string;
    userId: string;
    characterId: string;
    scope: MemoryScope;
    type: MemoryCandidateType;
    text: string;
    normalizedText: string;
    relatedEntities: string[];
    tags: string[];
    status: MemoryStagingStatus;
    statusReason: string | null;
    occurrenceCount: number;
    firstSeenAt: string;
    lastSeenAt: string;
    embedding: MemoryEmbeddingSignature | null;
    schemaVersion: number;
    createdAt: string;
    updatedAt: string;
}

/**
 * Projection of one memory retained row. Batch 3.5 does not write
 * to this table; the DTO exists so the debug contract stays stable
 * across batches and the route can return an empty list shape
 * without breaking clients.
 */
export interface MemoryRetainedInfo {
    id: string;
    userId: string;
    characterId: string;
    scope: MemoryScope;
    type: MemoryCandidateType;
    text: string;
    normalizedText: string;
    relatedEntities: string[];
    tags: string[];
    status: MemoryRetainedStatus;
    importance: number;
    embedding: MemoryEmbeddingSignature | null;
    schemaVersion: number;
    createdAt: string;
    updatedAt: string;
}

// ── Request / response shapes ───────────────────────────────────────────────

/**
 * Filters for `ApiListMemoryCandidates`. All filters are optional;
 * `userId` is never accepted from the client — the server forces it
 * to the authenticated user.
 *
 * Multi-value filters (`status`) accept either a repeated query
 * param (`?status=pending&status=processed`) or a comma-separated
 * list (`?status=pending,processed`).
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
 * Filters for `ApiListMemoryStaging`. `sourceCandidateId` returns
 * the staging row (if any) that aggregated that candidate, which is
 * useful when stepping from a candidate row to its downstream effect.
 */
export interface ListMemoryStagingRequest {
    characterId?: string;
    scope?: MemoryScope | MemoryScope[];
    type?: MemoryCandidateType | MemoryCandidateType[];
    status?: MemoryStagingStatus | MemoryStagingStatus[];
    sourceCandidateId?: string;
    /** Default 100, hard max 500. Out-of-range values are clamped. */
    limit?: number;
}

export interface ListMemoryStagingResponse {
    staging: MemoryStagingInfo[];
}

/**
 * Filters for `ApiListMemoryRetained`. `characterId` is required
 * because every retained memory belongs to exactly one character
 * world; a scan that omitted it would have to fall back to "all
 * characters for this user", which is intentionally not supported
 * through this debug surface.
 */
export interface ListMemoryRetainedRequest {
    characterId: string;
    scope?: MemoryScope | MemoryScope[];
    type?: MemoryCandidateType | MemoryCandidateType[];
    status?: MemoryRetainedStatus | MemoryRetainedStatus[];
    /** Default 100, hard max 500. Out-of-range values are clamped. */
    limit?: number;
}

export interface ListMemoryRetainedResponse {
    retained: MemoryRetainedInfo[];
}

// ── Endpoints ────────────────────────────────────────────────────────────────

/** GET /v1/debug/memory-candidates — list candidate rows for the current user. */
export const ApiListMemoryCandidates =
    new ApiDefine<ListMemoryCandidatesRequest, ListMemoryCandidatesResponse>(
        "/v1/debug/memory-candidates",
        "GET",
    );

/** GET /v1/debug/memory-staging — list memory staging rows for the current user. */
export const ApiListMemoryStaging =
    new ApiDefine<ListMemoryStagingRequest, ListMemoryStagingResponse>(
        "/v1/debug/memory-staging",
        "GET",
    );

/** GET /v1/debug/memory-retained — list retained memories for the current user + character. */
export const ApiListMemoryRetained =
    new ApiDefine<ListMemoryRetainedRequest, ListMemoryRetainedResponse>(
        "/v1/debug/memory-retained",
        "GET",
    );
