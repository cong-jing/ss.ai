import type { MemoryEmbedding } from "../embedding/embeddingPorts.js";

/**
 * Pure similarity primitives + skip bookkeeping shared by the
 * ranker. No I/O, no logger, no provider knowledge. Keeping these
 * in their own file makes them trivially unit-testable and removes
 * any chance of circular imports between the ranker and the rest
 * of the pipeline.
 */

/**
 * Cosine similarity between two equal-length vectors.
 *
 * Returns `NaN` for any input that cannot produce a meaningful
 * similarity:
 *  - non-array inputs;
 *  - mismatched lengths;
 *  - empty vectors;
 *  - either side being the zero vector (norm = 0).
 *
 * The choice to return `NaN` (not throw, not return 0) lets callers
 * filter via `Number.isFinite` without try/catch, and prevents
 * accidental "100% similar to nothing" matches when zero vectors
 * sneak through from a buggy embedding adapter.
 */
export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
    if (!Array.isArray(a) || !Array.isArray(b)) return Number.NaN;
    if (a.length === 0 || a.length !== b.length) return Number.NaN;
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i += 1) {
        const av = a[i];
        const bv = b[i];
        dot += av * bv;
        normA += av * av;
        normB += bv * bv;
    }
    if (normA === 0 || normB === 0) return Number.NaN;
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Metadata describing the latent space a vector lives in. Two
 * vectors are only directly comparable when these match.
 *
 * `version` covers non-model factors (preprocessing changes, prompt
 * wrapping). Bump it deliberately when we want to invalidate stored
 * vectors without changing the model identifier.
 */
export interface EmbeddingSignature {
    provider: string;
    model: string;
    dim: number;
    version: number;
}

/**
 * True iff the two signatures describe the same latent space.
 *
 * Exported so the processor can emit per-memory debug log events
 * for signature mismatches without re-implementing the comparison.
 * (`rankSimilarMemories` returns only aggregate counts; per-memory
 * inspection lives in the caller.)
 */
export function signaturesMatch(
    embedding: MemoryEmbedding,
    required: EmbeddingSignature,
): boolean {
    return (
        embedding.provider === required.provider
        && embedding.model === required.model
        && embedding.dim === required.dim
        && embedding.version === required.version
    );
}

/**
 * Per-reason tally of memories that were inspected but excluded
 * from the ranking. Returned alongside `ranked` so the processor
 * can surface honest debug numbers instead of one undifferentiated
 * `skippedCount` that hides corruption signals.
 *
 * Counts are non-overlapping: each memory is attributed to the
 * first reason that matches, in the order checked below. Total
 * skipped = `noEmbedding + signatureMismatch + corruptDim +
 * nonFiniteSimilarity`. Callers that only need a total should use
 * the {@link totalSkipped} helper.
 */
export interface MemoryRankSkipBreakdown {
    /**
     * Memory has no stored embedding (null/undefined column). Cannot
     * compute similarity. Typically means the memory predates the
     * embedding adapter rollout, or its initial embed attempt failed
     * and was never retried.
     */
    noEmbedding: number;
    /**
     * Stored embedding's provider/model/dim/version disagrees with
     * the candidate's signature. Skipping protects from comparing
     * cosines across incompatible latent spaces — a high similarity
     * across signatures is meaningless and dangerous.
     */
    signatureMismatch: number;
    /**
     * Stored embedding's `vector.length` disagrees with its declared
     * `dim`. Treated as a data-corruption signal: refusing to rank
     * is safer than producing a plausible-looking but invalid number.
     */
    corruptDim: number;
    /**
     * Cosine similarity came out non-finite (NaN/±Infinity). Almost
     * always caused by a zero-magnitude vector slipping past upstream
     * guards. Counted separately from `corruptDim` so debug surfaces
     * can distinguish "bad metadata" from "bad numerics".
     */
    nonFiniteSimilarity: number;
}

export function emptyMemoryRankSkipBreakdown(): MemoryRankSkipBreakdown {
    return {
        noEmbedding: 0,
        signatureMismatch: 0,
        corruptDim: 0,
        nonFiniteSimilarity: 0,
    };
}

export function totalSkipped(breakdown: MemoryRankSkipBreakdown): number {
    return (
        breakdown.noEmbedding
        + breakdown.signatureMismatch
        + breakdown.corruptDim
        + breakdown.nonFiniteSimilarity
    );
}
