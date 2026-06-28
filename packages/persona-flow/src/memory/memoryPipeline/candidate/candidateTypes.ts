import type {
    MemoryCandidateType,
    MemoryScope,
    MemoryWriteCandidate,
} from "@ss-ai/contracts";
import type { MemoryEmbedding } from "../embedding/embeddingPorts.js";
import type { MemoryCandidateSource } from "../memoryPipelineTypes.js";

/**
 * Candidate-stage domain types.
 *
 * Kept separate from the store port so each stage file can import
 * the minimum surface it needs: stage code reads records, store
 * adapters read the port shapes.
 */

/**
 * A candidate the model wants to remember, before any persistence or
 * validation. Identical in shape to `MemoryWriteCandidate` but
 * re-exported as its own type so the memory module owns the input
 * contract and downstream code never has to reach back into
 * `@ss-ai/contracts` to talk about candidate text.
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
 * A fully-formed candidate row. Storage adapters return this shape.
 *
 * `seq` is the 0-based index inside the originating assistant turn
 * so UI can display "candidate 2 of 3" and downstream reproducers
 * can line up with prompt logs.
 */
export interface MemoryCandidateRecord {
    id: string;
    source: MemoryCandidateSource;
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
