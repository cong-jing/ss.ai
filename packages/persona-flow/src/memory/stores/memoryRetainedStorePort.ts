import type {
    MemoryCandidateType,
    MemoryScope,
} from "@ss-ai/contracts";
import type { MemoryEmbedding } from "../embedding/embeddingPorts.js";

/**
 * Memory retained store port + record shape.
 *
 * "Retained memory" = a consolidated long-term memory that
 * participates in the next chat turn's context. Batch 3.5 does not
 * persist into this table yet; the port is declared so the storage
 * adapter and the debug surface can be wired now, and the Batch 4
 * consolidation pass can ship without re-introducing this scaffolding.
 *
 * Co-located with the port so consumers are one import away from
 * both: stage code reads records, adapters read input shapes.
 */

export const MEMORY_RETAINED_STATUSES = ["active", "archived"] as const;
export type MemoryRetainedStatus = typeof MEMORY_RETAINED_STATUSES[number];

/**
 * A persisted long-term memory.
 *
 * `characterId` is required: every memory is scoped to exactly one
 * character world. `scope` only classifies the memory inside that
 * character; it never lets a memory cross characters.
 */
export interface MemoryRetainedRecord {
    id: string;
    userId: string;
    characterId: string;
    scope: MemoryScope;
    type: MemoryCandidateType;
    text: string;
    normalizedText: string;
    relatedEntities: string[];
    tags: string[];
    /**
     * Reference back to the staging row this retained memory was
     * consolidated from. Optional because manual / judge-driven
     * insertions may bypass staging entirely.
     */
    sourceStagingId?: string;
    status: MemoryRetainedStatus;
    importance: number;
    /**
     * How many distinct staging rows have been consolidated into
     * this retained memory. Starts at 1 on create; merge/update
     * accumulate so a debug view can show "this fact keeps coming up".
     */
    occurrenceCount: number;
    /** First time evidence for this memory was seen. */
    firstSeenAt: string;
    /** Most recent time evidence for this memory was reinforced. */
    lastSeenAt: string;
    embedding?: MemoryEmbedding;
    schemaVersion: number;
    createdAt: string;
    updatedAt: string;
}

export interface ListMemoryRetainedInput {
    userId: string;
    characterId: string;
    scope?: MemoryScope | MemoryScope[];
    type?: MemoryCandidateType | MemoryCandidateType[];
    status?: MemoryRetainedStatus | MemoryRetainedStatus[];
    /** Default and maximum are enforced by the store, not the caller. */
    limit?: number;
}

/**
 * Read-only port for Batch 3.5. The consolidation pass that writes
 * retained rows lives in Batch 4 and will extend this port with the
 * `create` / `update` / `archive` operations it needs at that time.
 */
export interface MemoryRetainedStore {
    list(input: ListMemoryRetainedInput): Promise<MemoryRetainedRecord[]>;
    create(input: CreateMemoryRetainedInput): Promise<MemoryRetainedRecord>;
    update(input: UpdateMemoryRetainedInput): Promise<MemoryRetainedRecord>;
    archive(input: ArchiveMemoryRetainedInput): Promise<void>;
}

/**
 * Create a brand-new retained memory. Batch 4 only creates `active`
 * rows. `occurrenceCount` seeds the frequency signal (usually the
 * source staging's occurrence) and `firstSeenAt` / `lastSeenAt`
 * bracket the evidence window.
 */
export interface CreateMemoryRetainedInput {
    id: string;
    userId: string;
    characterId: string;
    scope: MemoryScope;
    type: MemoryCandidateType;
    text: string;
    normalizedText: string;
    relatedEntities: string[];
    tags: string[];
    sourceStagingId?: string;
    status: "active";
    importance: number;
    occurrenceCount: number;
    firstSeenAt: string;
    lastSeenAt: string;
    embedding?: MemoryEmbedding;
    now: string;
}

/**
 * Apply a judge-driven update/merge. Only the provided fields are
 * overwritten. `occurrenceDelta` accumulates the frequency signal;
 * `lastSeenAt` advances to the merged evidence's latest sighting.
 */
export interface UpdateMemoryRetainedInput {
    memoryRetainedId: string;
    text?: string;
    normalizedText?: string;
    relatedEntities?: string[];
    tags?: string[];
    sourceStagingId?: string;
    importance?: number;
    occurrenceDelta?: number;
    lastSeenAt?: string;
    embedding?: MemoryEmbedding;
    updatedAt: string;
}

export interface ArchiveMemoryRetainedInput {
    memoryRetainedId: string;
    statusReason?: string;
    updatedAt: string;
}
