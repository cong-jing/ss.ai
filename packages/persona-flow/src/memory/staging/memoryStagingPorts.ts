import type {
    MemoryCandidateType,
    MemoryScope,
} from "@ss-ai/contracts";
import type { MemoryEmbedding } from "../embedding/embeddingPorts.js";
import type {
    MemoryStagingRecord,
    MemoryStagingSourceRecord,
    MemoryStagingStatus,
} from "./memoryStagingTypes.js";

/**
 * Storage port for the memory staging stage.
 *
 * Adapters keep their own provider-specific schema; this file is
 * provider-free so the staging processor can be tested against an
 * in-memory fake without standing up a real DB.
 *
 * The port intentionally exposes both "find existing aggregation
 * candidate" (`findExact`) and "make my candidate-staging link
 * idempotent" (`findBySourceCandidate`). The latter is what makes a
 * retried processor run safe: if the candidate already has a link,
 * the processor short-circuits without double-counting.
 */

export interface CreateMemoryStagingInput {
    userId: string;
    characterId: string;
    scope: MemoryScope;
    type: MemoryCandidateType;
    text: string;
    normalizedText: string;
    relatedEntities: string[];
    tags: string[];
    status: MemoryStagingStatus;
    statusReason?: string;
    /** Source candidate's `createdAt`. Used to seed `firstSeenAt`. */
    firstSeenAt: string;
    /** Current wall-clock for both `lastSeenAt` and the audit columns. */
    now: string;
    embedding?: MemoryEmbedding;
    /**
     * First contributing candidate. Stored adapters MUST create the
     * matching `memory_staging_sources` row atomically with the
     * staging row.
     */
    initialSource: {
        candidateId: string;
        candidateSeq: number;
    };
}

export interface FindBySourceCandidateInput {
    candidateId: string;
}

export interface FindExactStagingInput {
    userId: string;
    characterId: string;
    scope: MemoryScope;
    type: MemoryCandidateType;
    normalizedText: string;
}

export interface LinkStagingSourceInput {
    memoryStagingId: string;
    candidateId: string;
    candidateSeq: number;
    /** Wall-clock for the link row. */
    createdAt: string;
}

export interface IncrementMemoryStagingOccurrenceInput {
    memoryStagingId: string;
    /** New `lastSeenAt` value (typically `nowIso()`). */
    lastSeenAt: string;
    /** New `updatedAt` value. */
    updatedAt: string;
}

export interface ListMemoryStagingInput {
    userId: string;
    characterId?: string;
    scope?: MemoryScope | MemoryScope[];
    type?: MemoryCandidateType | MemoryCandidateType[];
    status?: MemoryStagingStatus | MemoryStagingStatus[];
    /**
     * When set, return only the staging row that aggregated this
     * candidate (via `memory_staging_sources`). Returns an empty
     * list when no link exists.
     */
    sourceCandidateId?: string;
    /** Default and maximum are enforced by the store, not the caller. */
    limit?: number;
}

/**
 * Storage port.
 *
 * Each method runs as one logical unit. The `create` and `linkSource`
 * helpers may overlap on the underlying tables, so SQLite adapters
 * SHOULD wrap each call in a transaction; the in-memory fake gets
 * the same guarantee for free.
 */
export interface MemoryStagingStore {
    /**
     * Returns the staging row already linked to `candidateId` via
     * `memory_staging_sources`, if any. The processor uses this to
     * make retries idempotent: a candidate that successfully linked
     * to a staging row in a previous run is recognised and skipped.
     */
    findBySourceCandidate(input: FindBySourceCandidateInput): Promise<MemoryStagingRecord | undefined>;

    /**
     * Returns the staging row whose `(userId, characterId, scope,
     * type, normalizedText)` matches the input, if any. Used by
     * the duplicate aggregation step.
     */
    findExact(input: FindExactStagingInput): Promise<MemoryStagingRecord | undefined>;

    /**
     * Creates a fresh staging row AND its first
     * `memory_staging_sources` link in one logical step.
     */
    create(input: CreateMemoryStagingInput): Promise<MemoryStagingRecord>;

    /**
     * Adds a candidate -> staging link without bumping
     * `occurrenceCount` or `lastSeenAt`. Returns the persisted link
     * row. Pair with `incrementOccurrence` on the duplicate path.
     */
    linkSource(input: LinkStagingSourceInput): Promise<MemoryStagingSourceRecord>;

    /**
     * Atomically increments `occurrenceCount` and updates
     * `lastSeenAt` / `updatedAt`. Does NOT create a link by itself;
     * the duplicate path calls `linkSource` first.
     */
    incrementOccurrence(input: IncrementMemoryStagingOccurrenceInput): Promise<MemoryStagingRecord>;

    /** Read-only listing for the debug API. */
    list(input: ListMemoryStagingInput): Promise<MemoryStagingRecord[]>;
}
