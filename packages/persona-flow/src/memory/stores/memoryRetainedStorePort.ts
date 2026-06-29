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
}
