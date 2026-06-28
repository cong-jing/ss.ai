import type { MemoryEmbedding } from "../embedding/embeddingPorts.js";
import type { MemoryCandidateSource } from "../memoryPipelineTypes.js";
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
    /**
     * Pre-normalized text per candidate, indexed the same as
     * `candidates`. The recorder is responsible for normalization so
     * the store does not need to know the policy.
     */
    normalizedTexts: string[];
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

export interface UpdateMemoryCandidateStatusInput {
    candidateId: string;
    status: MemoryCandidateStatus;
    /** Optional reason for transitions like `commit_failed`. */
    reason?: string;
    updatedAt: string;
}

export interface SaveCandidateEmbeddingInput {
    candidateId: string;
    embedding: MemoryEmbedding;
    updatedAt: string;
}

export interface MemoryCandidateStore {
    appendCandidates(input: AppendMemoryCandidatesInput): Promise<MemoryCandidateRecord[]>;
    listCandidates(input: ListMemoryCandidatesInput): Promise<MemoryCandidateRecord[]>;
    updateCandidateStatus(input: UpdateMemoryCandidateStatusInput): Promise<void>;
    saveCandidateEmbedding(input: SaveCandidateEmbeddingInput): Promise<void>;
}
