import type { ActiveMemoryRecord, MemoryEmbedding } from "./types.js";

/**
 * Pure similarity primitives.
 *
 * No I/O, no provider knowledge, no policy. The commit service is
 * responsible for fetching embeddings and applying thresholds; this
 * module just turns vectors into ordered numbers.
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

export interface RankSimilarMemoriesOptions {
    topK: number;
    /**
     * If provided, memories whose stored embedding has a different
     * signature are skipped (not ranked low — skipped entirely).
     * Leaving this undefined disables the check, which is intended
     * for tests using ad-hoc vectors.
     */
    requireSignature?: EmbeddingSignature;
}

export interface RankedMemory {
    memory: ActiveMemoryRecord;
    similarity: number;
}

function signaturesMatch(
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
 * Rank memories by cosine similarity to the candidate vector.
 *
 * Skips memories that:
 *  - have no stored embedding;
 *  - have an embedding whose signature mismatches
 *    `options.requireSignature` (when provided);
 *  - have an embedding whose `vector.length !== embedding.dim`
 *    (declared dim disagrees with stored vector — treated as a
 *    corruption signal, not silently ranked);
 *  - produce a non-finite similarity (e.g. zero vector slipped
 *    through, or a corrupted vector with mismatched length).
 *
 * Also returns `[]` when `requireSignature` is supplied but the
 * candidate vector's own length disagrees with `requireSignature.dim`.
 * This is the last defensive line before ranking: refusing to rank
 * is safer than producing a plausible-looking but space-incoherent
 * result.
 *
 * Returns at most `options.topK` entries, sorted by descending
 * similarity. The sort is stable on similarity but does not
 * guarantee any specific tiebreak order across runs; callers that
 * need a deterministic display order should sort again by memory id.
 */
export function rankSimilarMemories(
    candidateVector: readonly number[],
    memories: readonly ActiveMemoryRecord[],
    options: RankSimilarMemoriesOptions,
): RankedMemory[] {
    if (!Array.isArray(candidateVector) || candidateVector.length === 0) {
        return [];
    }
    if (options.topK <= 0) return [];
    if (options.requireSignature && candidateVector.length !== options.requireSignature.dim) {
        return [];
    }

    const scored: RankedMemory[] = [];
    for (const memory of memories) {
        const embedding = memory.embedding;
        if (!embedding) continue;
        if (options.requireSignature && !signaturesMatch(embedding, options.requireSignature)) {
            continue;
        }
        // Defensive: declared dim must match actual vector length.
        // A mismatch here means the row is corrupted or the adapter
        // is buggy; rank-and-pray would silently propagate the bug.
        if (embedding.vector.length !== embedding.dim) continue;
        const similarity = cosineSimilarity(candidateVector, embedding.vector);
        if (!Number.isFinite(similarity)) continue;
        scored.push({ memory, similarity });
    }
    scored.sort((a, b) => b.similarity - a.similarity);
    if (scored.length <= options.topK) return scored;
    return scored.slice(0, options.topK);
}
