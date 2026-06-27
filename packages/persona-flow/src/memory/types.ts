import type {
    MemoryCandidateType,
    MemoryScope,
    MemoryWriteCandidate,
} from "@ss-ai/contracts";

/**
 * Domain types for the memory write subsystem.
 *
 * This module is intentionally pure: it knows nothing about chat turns,
 * model calls, providers, or SQLite. It defines the shape of the data
 * that flows between the recorder, the commit service, and the stores.
 * Reuse stable contract types (scope/type/candidate) instead of
 * redefining them locally so the boundary with `@ss-ai/contracts`
 * stays narrow.
 */

/**
 * Identifies where a candidate came from, so any downstream record
 * (candidate row, decision row, active memory, debug event) can be
 * traced back to a chat turn.
 */
export interface MemoryCandidateSource {
    userId: string;
    characterId: string;
    conversationId: string;
    userMessageId: string;
    assistantMessageId: string;
    requestId: string;
    /**
     * Free-form purpose name, e.g. "chat.main". A string instead of a
     * union so the memory module does not need to track every new
     * model-call purpose added elsewhere.
     */
    modelCallPurpose: string;
}

/**
 * A candidate the model wants to remember, before any persistence or
 * validation. Identical in shape to `MemoryWriteCandidate` but kept
 * as its own type so the memory module owns the input contract.
 */
export type MemoryCandidateDraft = MemoryWriteCandidate;

/**
 * Lifecycle status for a saved candidate. Storage layers may keep
 * additional provider-specific columns, but every implementation
 * must round-trip exactly these values.
 */
export const MEMORY_CANDIDATE_STATUSES = [
    "pending",
    "embedded",
    "committed",
    "ignored_duplicate",
    "ignored_low_value",
    "needs_judge",
    "embedding_failed",
    "commit_failed",
] as const;

export type MemoryCandidateStatus = typeof MEMORY_CANDIDATE_STATUSES[number];

/**
 * Lifecycle status for an active memory row. Batch 2/3 only writes
 * `active`; `archived` is reserved for later work.
 */
export const MEMORY_STATUSES = ["active", "archived"] as const;

export type MemoryStatus = typeof MEMORY_STATUSES[number];

/**
 * Result of an embedding request, plus the metadata that lets later
 * similarity checks decide whether two vectors are comparable.
 *
 * `provider`, `model`, `dim`, and `version` together form the
 * "embedding signature": vectors with different signatures live in
 * different latent spaces and must not be compared directly.
 *
 * `version` represents non-model factors (text preprocessing, prompt
 * wrapping, normalization strategy). Bump it whenever those change
 * even if the underlying model is unchanged.
 */
export interface MemoryEmbedding {
    vector: number[];
    provider: string;
    model: string;
    dim: number;
    version: number;
    createdAt: string;
}

/**
 * A fully-formed candidate row. Storage adapters return this shape.
 */
export interface MemoryCandidateRecord {
    id: string;
    source: MemoryCandidateSource;
    /**
     * 0-based index inside the originating assistant turn. Lets the
     * UI display "candidate 2 of 3" and lets downstream reproducers
     * line up with prompt logs.
     */
    seq: number;
    scope: MemoryScope;
    type: MemoryCandidateType;
    text: string;
    normalizedText: string;
    relatedEntities: string[];
    tags: string[];
    reason?: string;
    status: MemoryCandidateStatus;
    embedding?: MemoryEmbedding;
    schemaVersion: number;
    createdAt: string;
    updatedAt: string;
}

/**
 * A persisted long-term memory. The source ids are optional because
 * future flows (manual curation, judge-driven merges) may create
 * memories that do not map back to a single candidate.
 */
export interface ActiveMemoryRecord {
    id: string;
    userId: string;
    characterId?: string;
    scope: MemoryScope;
    type: MemoryCandidateType;
    text: string;
    normalizedText: string;
    relatedEntities: string[];
    tags: string[];
    sourceCandidateId?: string;
    sourceConversationId?: string;
    sourceUserMessageId?: string;
    sourceAssistantMessageId?: string;
    status: MemoryStatus;
    importance: number;
    embedding?: MemoryEmbedding;
    schemaVersion: number;
    createdAt: string;
    updatedAt: string;
}

/**
 * Final decision kinds the commit service can produce for one
 * candidate. The commit service is the only writer of these values;
 * adding a new kind should always be paired with a policy update.
 */
export const MEMORY_DECISION_KINDS = [
    "create",
    "ignore_duplicate",
    "ignore_low_value",
    "needs_judge",
    "embedding_failed",
    "error",
] as const;

export type MemoryDecisionKind = typeof MEMORY_DECISION_KINDS[number];

/**
 * One entry of a topK similarity summary, persisted with each
 * decision so debugging does not need to re-run the scan.
 */
export interface MemorySimilaritySummaryEntry {
    memoryId: string;
    similarity: number;
    /**
     * Snapshot of memory text at decision time. Stored to keep the
     * decision row self-contained even if the memory is later edited.
     */
    text: string;
}

/**
 * Persisted commit decision for one candidate.
 */
export interface MemoryDecisionRecord {
    id: string;
    candidateId: string;
    userId: string;
    characterId?: string;
    decision: MemoryDecisionKind;
    /** Set only when `decision === "create"`. */
    memoryId?: string;
    reason?: string;
    similarity: MemorySimilaritySummaryEntry[];
    policyVersion: number;
    createdAt: string;
}

/**
 * Minimal vendor-neutral input shape passed to a
 * {@link MemoryEmbeddingProvider}.
 */
export interface MemoryEmbedInput {
    text: string;
    /**
     * Free-form purpose tag, e.g. "memory.write.candidate" or
     * "memory.read.query". Adapters can ignore it; some providers
     * expose a similar concept (e.g. "task type") and may map it.
     */
    purpose: string;
    /**
     * Optional caller identity. Adapters use it to honour per-user model
     * assignments and credentials; omit when calling on behalf of a system
     * job (the adapter will fall back to default config).
     */
    userId?: string;
}

/**
 * Output of a single embedding call. Adapters are responsible for
 * filling in all metadata fields; consumers should never have to
 * guess provider/model/dim/version.
 */
export interface MemoryEmbedResult {
    embedding: MemoryEmbedding;
    /** Optional token usage so the commit service can log it. */
    usage?: {
        promptTokens?: number;
        totalTokens?: number;
    };
}

/**
 * Schema version of the in-process domain types. Bump alongside any
 * breaking change to the record shapes so storage adapters can
 * migrate older rows on read.
 */
export const MEMORY_SCHEMA_VERSION = 1 as const;
