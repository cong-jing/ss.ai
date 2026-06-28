import type { MemoryCandidateRecord } from "../candidate/candidateTypes.js";
import type { MemoryDecisionKind } from "../decision/decisionPorts.js";
import type { MemoryRankSkipBreakdown } from "../ranking/similarity.js";

/**
 * Per-candidate outcome of
 * {@link MemoryCandidateProcessor.processCandidates}.
 *
 * Returned even for non-`create` decisions so callers (debug API,
 * tests) can render a uniform table of "what happened" without
 * peeking at internal stores.
 */
export interface MemoryCandidateProcessingOutcome {
    candidateId: string;
    decision: MemoryDecisionKind;
    /** Set only when `decision === "create"`. */
    memoryId?: string;
    reason?: string;
    /** Cosine similarity of the top-ranked existing memory, when computed. */
    topSimilarity?: number;
    /**
     * Total number of active memories fetched from the store for
     * this candidate's bucket (before any skip filtering). Useful
     * as the denominator for `skipped`.
     */
    scannedCount?: number;
    /**
     * Per-reason tally of memories that were inspected but excluded
     * from the ranking. See {@link MemoryRankSkipBreakdown} for the
     * meaning of each field. Set whenever a similarity scan ran
     * (i.e. not for low-value / exact-duplicate / embedding-failed
     * branches that short-circuited before scanning).
     */
    skipped?: MemoryRankSkipBreakdown;
    /** Set when the per-candidate pipeline threw; never surfaces as a thrown error. */
    error?: Error;
}

export interface ProcessMemoryCandidatesInput {
    candidates: MemoryCandidateRecord[];
}

export interface ProcessMemoryCandidatesResult {
    outcomes: MemoryCandidateProcessingOutcome[];
}
