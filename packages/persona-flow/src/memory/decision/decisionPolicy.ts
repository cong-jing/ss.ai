import type { MemoryCandidateDraft } from "../candidate/candidateTypes.js";
import { normalizeMemoryText } from "../candidate/textNormalization.js";
import type { RankedMemory } from "../ranking/rankSimilarMemories.js";
import type { MemoryDecisionKind } from "./decisionPorts.js";

/**
 * Pure decision rules.
 *
 * Inputs: ranked similar memories + thresholds.
 * Outputs: a decision kind and an explanation.
 *
 * The processor wires these into the candidate / memory / decision
 * stores. This module does no I/O so thresholds can be tuned with
 * a script in seconds.
 */

export interface MemoryDecisionPolicy {
    /**
     * Similarity ≥ this is treated as an exact duplicate. In Batch
     * 2/3 we conservatively route these to `needs_judge` instead of
     * dropping silently, so an operator can confirm before we stop
     * surfacing them as new memories.
     */
    exactDuplicateThreshold: number;
    /**
     * Similarity ≥ this (but below `exactDuplicateThreshold`) means
     * "probably related — let a human / judge decide".
     */
    needsJudgeThreshold: number;
    /**
     * Cap on how many similar memories the processor should fetch
     * and persist in the decision summary. Kept here (not in the
     * service) so try-scripts can mutate it in one place.
     */
    topK: number;
    /**
     * Bumped whenever the algorithm or thresholds change in a way
     * that should invalidate previously-stored decisions. Stored
     * alongside every decision row for auditability.
     */
    policyVersion: number;
}

export const defaultMemoryDecisionPolicy: MemoryDecisionPolicy = {
    exactDuplicateThreshold: 0.95,
    needsJudgeThreshold: 0.80,
    topK: 10,
    policyVersion: 1,
};

export interface SimilarityDecision {
    kind: Extract<MemoryDecisionKind, "create" | "needs_judge">;
    reason: string;
    topSimilarity?: number;
}

/**
 * Decide whether a candidate should become a new memory based on
 * the top-K similar existing memories.
 *
 * Returns `create` when nothing meaningfully similar exists.
 * Returns `needs_judge` for anything at or above the lower
 * threshold, including the "exact duplicate" band — Batch 2/3
 * deliberately does NOT auto-drop duplicates so we can observe
 * provider behaviour first.
 *
 * Never returns `ignore_low_value` or `ignore_duplicate`; those are
 * the caller's responsibility (`isLowValueCandidate` for the former,
 * exact normalized-text lookup for the latter).
 */
export function decideBySimilarity(
    ranked: readonly RankedMemory[],
    policy: MemoryDecisionPolicy,
): SimilarityDecision {
    if (ranked.length === 0) {
        return { kind: "create", reason: "no_similar_memories" };
    }
    const top = ranked[0]!.similarity;
    if (top >= policy.exactDuplicateThreshold) {
        return {
            kind: "needs_judge",
            reason: "exact_duplicate_threshold",
            topSimilarity: top,
        };
    }
    if (top >= policy.needsJudgeThreshold) {
        return {
            kind: "needs_judge",
            reason: "needs_judge_threshold",
            topSimilarity: top,
        };
    }
    return { kind: "create", reason: "below_needs_judge_threshold", topSimilarity: top };
}

export interface LowValueAssessment {
    lowValue: boolean;
    reason?: string;
}

/**
 * Minimum normalized length below which a candidate is considered
 * low value (one or two CJK characters, a single English word).
 * Conservative on purpose — false negatives are fine, false
 * positives are not (we would silently throw away real memories).
 */
const MIN_NORMALIZED_LENGTH = 2;

/**
 * Conservative pre-filter. Returns `{ lowValue: true }` only when
 * we are quite sure the text carries no rememberable content:
 *  - empty after normalization;
 *  - too short to plausibly mean anything;
 *  - made up only of emoji / punctuation / whitespace.
 *
 * Anything ambiguous returns `{ lowValue: false }` so the candidate
 * still goes through the similarity / judge pipeline.
 */
export function isLowValueCandidate(draft: MemoryCandidateDraft): LowValueAssessment {
    const normalized = normalizeMemoryText(draft.text);
    if (normalized.length === 0) {
        return { lowValue: true, reason: "empty_after_normalize" };
    }
    if (normalized.length < MIN_NORMALIZED_LENGTH) {
        return { lowValue: true, reason: "too_short" };
    }
    // Strip everything that is not a letter / digit / CJK character
    // and check if anything is left. Uses Unicode property escapes
    // so it works for CJK, Cyrillic, Arabic, etc.
    const hasContent = /[\p{L}\p{N}]/u.test(normalized);
    if (!hasContent) {
        return { lowValue: true, reason: "no_letter_or_digit" };
    }
    return { lowValue: false };
}
