import type {
    MemoryCandidateType,
    MemoryScope,
} from "@ss-ai/contracts";
import type { MemoryEmbedding } from "../embedding/embeddingPorts.js";

/**
 * Active-memory store port + record shape.
 *
 * "Active memory" = a persisted long-term memory that participates
 * in the next chat turn's context. Co-locating the record type with
 * the port keeps every consumer one import away from both: stage
 * code reads records, store adapters read the input shapes.
 */

/**
 * Lifecycle status for an active memory row. The current write path
 * only writes `active`; `archived` is reserved for later work.
 */
export const MEMORY_STATUSES = ["active", "archived"] as const;
export type MemoryStatus = typeof MEMORY_STATUSES[number];

/**
 * A persisted long-term memory.
 *
 * `characterId` is required: every memory is scoped to a specific
 * character world. `scope` only classifies the memory inside that
 * character; it never makes a memory cross characters.
 *
 * The source ids are optional because future flows (manual
 * curation, judge-driven merges) may create memories that do not
 * map back to a single candidate.
 */
export interface ActiveMemoryRecord {
    id: string;
    userId: string;
    characterId: string;
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

export interface CreateMemoryInput {
    userId: string;
    characterId: string;
    scope: MemoryScope;
    type: MemoryCandidateType;
    text: string;
    normalizedText: string;
    relatedEntities: string[];
    tags: string[];
    importance: number;
    sourceCandidateId?: string;
    sourceConversationId?: string;
    sourceUserMessageId?: string;
    sourceAssistantMessageId?: string;
    embedding?: MemoryEmbedding;
    createdAt: string;
    updatedAt: string;
}

export interface ListActiveMemoriesInput {
    userId: string;
    /**
     * Required: every memory lives inside one character world, so
     * scans must always be bounded by `characterId`. `scope` /
     * `type` further narrow the bucket inside that world.
     */
    characterId: string;
    scope?: MemoryScope | MemoryScope[];
    type?: MemoryCandidateType | MemoryCandidateType[];
    status?: MemoryStatus | MemoryStatus[];
    /**
     * Hard cap on the brute-force similarity scan.
     *
     * Implementations MUST return rows in a deterministic order so
     * truncation is reproducible: newest first by `updatedAt`
     * (descending), then `createdAt` (descending), then `id`
     * (ascending) as a tiebreaker. Callers rely on this to keep
     * processor decisions stable; without it, once a bucket
     * exceeds the cap the similarity scan would silently depend on
     * storage order.
     */
    limit?: number;
}

export interface FindExactActiveMemoryInput {
    userId: string;
    characterId: string;
    scope: MemoryScope;
    type: MemoryCandidateType;
    normalizedText: string;
}

export interface SaveMemoryEmbeddingInput {
    memoryId: string;
    embedding: MemoryEmbedding;
    updatedAt: string;
}

export interface MemoryStore {
    createMemory(input: CreateMemoryInput): Promise<ActiveMemoryRecord>;
    listActiveMemories(input: ListActiveMemoriesInput): Promise<ActiveMemoryRecord[]>;
    findExactActiveMemory(input: FindExactActiveMemoryInput): Promise<ActiveMemoryRecord | undefined>;
    saveMemoryEmbedding(input: SaveMemoryEmbeddingInput): Promise<void>;
}
