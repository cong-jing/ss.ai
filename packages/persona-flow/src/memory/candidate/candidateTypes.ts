import type {
    MemoryCandidateType,
    MemoryScope,
    MemoryWriteCandidate,
} from "@ss-ai/contracts";
import type { MemoryCandidateSource } from "../types.js";

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
 * Lifecycle status for a saved candidate.
 *
 * Batch 3.5 narrowed the candidate row to "raw intake + processing
 * state". Downstream evidence (embedding, normalized text,
 * duplicate aggregation) lives on `memory_staging` instead of being
 * folded back onto the candidate row.
 *
 * Status meanings:
 *  - `pending`: just intaken, has not been processed yet.
 *  - `processing`: claimed by a processor run (reserved for the
 *    background worker introduced in Batch 4; Batch 3.5 inline
 *    processing currently skips this state and goes straight to a
 *    terminal status).
 *  - `processed`: a memory staging row was created or updated for
 *    this candidate (or the candidate matched an existing staging
 *    row by normalized text). The candidate is done.
 *  - `rejected_by_rule`: a deterministic rule (low-value filter,
 *    empty text) rejected this candidate before any embedding or
 *    staging write happened.
 *  - `failed`: a non-deterministic step (embedding provider,
 *    staging store) failed and the candidate could not be
 *    converted. May be retried by a background worker.
 *
 * Storage layers may keep additional provider-specific columns,
 * but every implementation must round-trip exactly these values.
 */
export const MEMORY_CANDIDATE_STATUSES = [
    "pending",
    "processing",
    "processed",
    "rejected_by_rule",
    "failed",
] as const;

export type MemoryCandidateStatus = typeof MEMORY_CANDIDATE_STATUSES[number];

/**
 * A fully-formed candidate row. Storage adapters return this shape.
 *
 * `seq` is the 0-based index inside the originating assistant turn
 * so UI can display "candidate 2 of 3" and downstream reproducers
 * can line up with prompt logs.
 *
 * `candidateReason` and `statusReason` split what used to be a
 * single `reason` field: the first is the model's stated intent
 * for proposing this candidate, the second is the processor's
 * stated outcome when transitioning the row (e.g.
 * `"staging_created"`, `"low_value"`, `"embedding_failed"`).
 * Neither field is normalized or interpreted by storage.
 */
export interface MemoryCandidateRecord {
    id: string;
    source: MemoryCandidateSource;
    seq: number;
    scope: MemoryScope;
    type: MemoryCandidateType;
    text: string;
    relatedEntities: string[];
    tags: string[];
    candidateReason?: string;
    status: MemoryCandidateStatus;
    statusReason?: string;
    schemaVersion: number;
    createdAt: string;
    updatedAt: string;
}
