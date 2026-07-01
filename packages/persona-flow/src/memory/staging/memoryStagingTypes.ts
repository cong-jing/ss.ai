import type {
    MemoryCandidateType,
    MemoryScope,
} from "@ss-ai/contracts";
import type { MemoryEmbedding } from "../embedding/embeddingPorts.js";

/**
 * Memory staging stage domain types.
 *
 * Memory staging sits between raw candidates and consolidated
 * retained memories. A staging row aggregates *evidence* (one or
 * more candidates that say the same thing, the normalized text used
 * to detect duplicates, and the embedding signature) but is NOT a
 * long-term memory yet. The consolidation pass that turns staging
 * rows into `memory_retained` rows lives in Batch 4.
 *
 * Co-located with the port so each consumer is one import away from
 * both: stage code reads records, adapters read input shapes.
 */

/**
 * Lifecycle status for a staging row.
 *
 * `pending` — the only status Batch 3.5 actively writes.
 * `processed` — reserved for Batch 4 consolidation success.
 * `archived` — reserved for "consolidated and superseded".
 * `forgotten` — reserved for explicit forget operations.
 * `failed` — reserved for terminal staging-write failures that
 * could not be retried.
 *
 * Storage adapters MUST round-trip these values without coercion.
 */
export const MEMORY_STAGING_STATUSES = [
    "pending",
    "processed",
    "archived",
    "forgotten",
    "failed",
] as const;

export type MemoryStagingStatus = typeof MEMORY_STAGING_STATUSES[number];

/**
 * One staging row.
 *
 * `occurrenceCount` is the number of distinct candidates that have
 * been folded into this row (via `linkSource` / `incrementOccurrence`).
 * `firstSeenAt` is the source candidate's `createdAt` at the moment
 * the row was created; `lastSeenAt` is updated to `nowIso()` on
 * every increment so a debug view can show "this evidence was last
 * confirmed N minutes ago".
 */
export interface MemoryStagingRecord {
    id: string;
    userId: string;
    characterId: string;
    scope: MemoryScope;
    type: MemoryCandidateType;
    text: string;
    /** Canonical form used for exact-duplicate aggregation. */
    normalizedText: string;
    relatedEntities: string[];
    tags: string[];
    status: MemoryStagingStatus;
    /** Free-form processor outcome ("created_from_candidate", 閳?. */
    statusReason?: string;
    occurrenceCount: number;
    firstSeenAt: string;
    lastSeenAt: string;
    embedding?: MemoryEmbedding;
    schemaVersion: number;
    createdAt: string;
    updatedAt: string;
}

/**
 * Link row between a staging row and the candidate that contributed
 * evidence to it. Composite primary key
 * `(memoryStagingId, candidateId)` on the storage side; a candidate
 * can only contribute to one staging row (UNIQUE on `candidateId`)
 * so future retries do not double-count.
 */
export interface MemoryStagingSourceRecord {
    memoryStagingId: string;
    candidateId: string;
    /** Snapshot of the candidate's `seq` for ordering in debug views. */
    candidateSeq: number;
    createdAt: string;
}
