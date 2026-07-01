import type { MemoryCandidateSource } from "../types.js";
import type {
    MemoryCandidateDraft,
    MemoryCandidateRecord,
    MemoryCandidateStatus,
} from "./candidateTypes.js";

/**
 * Storage port for the candidate stage.
 *
 * Concrete implementations (SQLite, in-memory fakes, future
 * remote stores) live in their own packages or adapters. Keep
 * this file provider-free.
 */

export interface AppendMemoryCandidatesInput {
    source: MemoryCandidateSource;
    candidates: MemoryCandidateDraft[];
}

export interface ListMemoryCandidatesInput {
    userId: string;
    characterId?: string;
    conversationId?: string;
    assistantMessageId?: string;
    status?: MemoryCandidateStatus | MemoryCandidateStatus[];
    /** Default and maximum are enforced by the store, not the caller. */
    limit?: number;
}

/**
 * Optional listing entrypoint for the candidate processor. Returns
 * candidate rows in `pending` status for a given (userId,
 * characterId) pair, ordered for stable batch processing.
 *
 * Kept on the same port as `listCandidates` because every
 * implementation (SQLite, in-memory fake) already has the rows on
 * hand; pulling pending work out into a separate port would force
 * adapters to share connections / table layouts redundantly.
 */
export interface ListPendingMemoryCandidatesInput {
    userId: string;
    characterId: string;
    limit: number;
}

/**
 * Status transition. `statusReason` is a free-form processor
 * outcome ("staging_created", "staging_duplicate_normalized_text",
 * "low_value", "embedding_failed", 閳? and is not interpreted by
 * the store.
 */
export interface UpdateMemoryCandidateStatusInput {
    candidateId: string;
    status: MemoryCandidateStatus;
    statusReason?: string;
    updatedAt: string;
}

export interface MemoryCandidateStore {
    appendCandidates(input: AppendMemoryCandidatesInput): Promise<MemoryCandidateRecord[]>;
    listCandidates(input: ListMemoryCandidatesInput): Promise<MemoryCandidateRecord[]>;
    listPendingCandidates(input: ListPendingMemoryCandidatesInput): Promise<MemoryCandidateRecord[]>;
    updateCandidateStatus(input: UpdateMemoryCandidateStatusInput): Promise<void>;
}
