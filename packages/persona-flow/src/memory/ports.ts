import type {
    MemoryCandidateType,
    MemoryScope,
} from "@ss-ai/contracts";
import type {
    ActiveMemoryRecord,
    MemoryCandidateDraft,
    MemoryCandidateRecord,
    MemoryCandidateSource,
    MemoryCandidateStatus,
    MemoryDecisionKind,
    MemoryDecisionRecord,
    MemoryEmbedInput,
    MemoryEmbedResult,
    MemoryEmbedding,
    MemorySimilaritySummaryEntry,
    MemoryStatus,
} from "./types.js";

/**
 * Ports for the memory write subsystem.
 *
 * The memory core depends only on these interfaces; concrete
 * implementations (SQLite, in-memory fakes, future vector DBs) live
 * in their own packages or adapters. Keep these types provider-free.
 */

// ---------- Candidate store ----------

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

// ---------- Memory store ----------

export interface CreateMemoryInput {
    userId: string;
    characterId?: string;
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
    /** Required to scope the scan: relationship/world memories may
     * have no characterId, so pass `null` explicitly to include them. */
    characterId?: string | null;
    scope?: MemoryScope | MemoryScope[];
    type?: MemoryCandidateType | MemoryCandidateType[];
    status?: MemoryStatus | MemoryStatus[];
    /**
     * Hard cap on the brute-force similarity scan.
     *
     * Implementations MUST return rows in a deterministic order so
     * that truncation is reproducible: newest first by `updatedAt`
     * (descending), then `createdAt` (descending), then `id`
     * (ascending) as a tiebreaker. Callers rely on this to keep
     * commit-service decisions stable — without it, once a bucket
     * exceeds the cap the similarity scan would silently depend on
     * storage order.
     */
    limit?: number;
}

export interface FindExactActiveMemoryInput {
    userId: string;
    characterId?: string | null;
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

// ---------- Decision store ----------

export interface AppendMemoryDecisionInput {
    candidateId: string;
    userId: string;
    characterId?: string;
    decision: MemoryDecisionKind;
    memoryId?: string;
    reason?: string;
    similarity: MemorySimilaritySummaryEntry[];
    policyVersion: number;
    createdAt: string;
}

export interface ListMemoryDecisionsInput {
    userId: string;
    candidateId?: string;
    decision?: MemoryDecisionKind | MemoryDecisionKind[];
    limit?: number;
}

export interface MemoryDecisionStore {
    appendDecision(input: AppendMemoryDecisionInput): Promise<MemoryDecisionRecord>;
    listDecisions(input: ListMemoryDecisionsInput): Promise<MemoryDecisionRecord[]>;
}

// ---------- Embedding provider ----------

export interface MemoryEmbeddingProvider {
    embed(input: MemoryEmbedInput): Promise<MemoryEmbedResult>;
}

// ---------- Cross-cutting deps ----------

export interface MemoryClock {
    nowIso(): string;
}

export interface MemoryIdGenerator {
    randomId(): string;
}

/**
 * Minimal logger contract. Compatible with `PersonaFlowLogger` but
 * redefined here so the memory module never imports chat turn code.
 */
export interface MemoryLogger {
    debug?(message: string, payload?: unknown): void;
    info(message: string, payload?: unknown): void;
    warn(message: string, payload?: unknown): void;
    error(message: string, payload?: unknown): void;
}

/**
 * Aggregate dependency bag for services like
 * `MemoryCandidateRecorder` and `MemoryCommitService`. Splitting it
 * up at every callsite is verbose; aggregating it here keeps
 * constructors short and lets server boot wire everything once.
 */
export interface MemoryRuntimeDeps {
    candidateStore: MemoryCandidateStore;
    memoryStore: MemoryStore;
    decisionStore: MemoryDecisionStore;
    embeddingProvider: MemoryEmbeddingProvider;
    clock: MemoryClock;
    ids: MemoryIdGenerator;
    logger?: MemoryLogger;
}
