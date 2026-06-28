import type { MemoryEmbedding } from "../embedding/embeddingPorts.js";

/**
 * Decision-stage port + record shape.
 *
 * `MemoryDecisionRecord` is co-located with the store port so any
 * consumer that reads decisions can do so with a single import.
 */

/**
 * Final decision kinds the processor can produce for one candidate.
 * The processor is the only writer of these values; adding a new
 * kind should always be paired with a policy update.
 */
export const MEMORY_DECISION_KINDS = [
    "create",
    "ignore_duplicate",
    "ignore_low_value",
    "needs_judge",
    "embedding_failed",
    "error",
] as const;

export type MemoryDecisionKind = typeof MEMORY_DECISION_KINDS[number];

/**
 * One entry of a topK similarity summary, persisted with each
 * decision so debugging does not need to re-run the scan.
 *
 * `text` is snapshotted at decision time on purpose — even if the
 * underlying memory is later edited or archived, the decision row
 * remains self-explanatory.
 */
export interface MemorySimilaritySummaryEntry {
    memoryId: string;
    similarity: number;
    text: string;
}

/**
 * Persisted decision row for one candidate.
 *
 * `characterId` mirrors the active memory's isolation key so a
 * decision row can always be traced back to a single character
 * world, even when no memory was ultimately created.
 */
export interface MemoryDecisionRecord {
    id: string;
    candidateId: string;
    userId: string;
    characterId: string;
    decision: MemoryDecisionKind;
    /** Set only when `decision === "create"`. */
    memoryId?: string;
    reason?: string;
    similarity: MemorySimilaritySummaryEntry[];
    policyVersion: number;
    createdAt: string;
}

// `MemoryEmbedding` is intentionally imported even though no field
// directly references it here — keeping the import stable means
// downstream files can ask `decisionPorts.ts` for the symbol via
// `import type { MemoryEmbedding } from "..."` if a future field
// (e.g. embedding snapshot per summary entry) is added without
// causing a churning import diff.
export type { MemoryEmbedding };

export interface AppendMemoryDecisionInput {
    candidateId: string;
    userId: string;
    characterId: string;
    decision: MemoryDecisionKind;
    memoryId?: string;
    reason?: string;
    similarity: MemorySimilaritySummaryEntry[];
    policyVersion: number;
    createdAt: string;
}

export interface ListMemoryDecisionsInput {
    userId: string;
    /**
     * Optional character bucket filter. Every decision row is
     * already bound to one character world via its required
     * `characterId`, so debug / admin callers can narrow a listing
     * to "decisions made for character X" without post-filtering.
     */
    characterId?: string;
    candidateId?: string;
    decision?: MemoryDecisionKind | MemoryDecisionKind[];
    limit?: number;
}

export interface MemoryDecisionStore {
    appendDecision(input: AppendMemoryDecisionInput): Promise<MemoryDecisionRecord>;
    listDecisions(input: ListMemoryDecisionsInput): Promise<MemoryDecisionRecord[]>;
}
