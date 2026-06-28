import type { ActiveMemoryRecord } from "../stores/activeMemoryStorePort.js";
import {
    cosineSimilarity,
    emptyMemoryRankSkipBreakdown,
    signaturesMatch,
    type EmbeddingSignature,
    type MemoryRankSkipBreakdown,
} from "./similarity.js";

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

export interface RankSimilarMemoriesResult {
    ranked: RankedMemory[];
    skipped: MemoryRankSkipBreakdown;
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
 * Each skipped memory is tallied under exactly one reason in the
 * returned `skipped` breakdown — checks run in the order above and
 * the first match wins. This guarantees `totalSkipped(skipped) +
 * ranked.length` accounts for every input memory exactly once
 * (modulo the early `topK` truncation, which trims from `ranked`
 * after scoring).
 *
 * Also returns `{ ranked: [], skipped: <all-zero> }` when
 * `requireSignature` is supplied but the candidate vector's own
 * length disagrees with `requireSignature.dim`. This is the last
 * defensive line before ranking: refusing to rank is safer than
 * producing a plausible-looking but space-incoherent result. The
 * skip breakdown stays zero in that case because we never inspected
 * any individual memory; the caller can detect this state via
 * `ranked.length === 0` combined with a positive memory input.
 *
 * `ranked` contains at most `options.topK` entries, sorted by
 * descending similarity. The sort is stable on similarity but does
 * not guarantee any specific tiebreak order across runs; callers
 * that need a deterministic display order should sort again by
 * memory id.
 */
export function rankSimilarMemories(
    candidateVector: readonly number[],
    memories: readonly ActiveMemoryRecord[],
    options: RankSimilarMemoriesOptions,
): RankSimilarMemoriesResult {
    const skipped = emptyMemoryRankSkipBreakdown();
    if (!Array.isArray(candidateVector) || candidateVector.length === 0) {
        return { ranked: [], skipped };
    }
    if (options.topK <= 0) return { ranked: [], skipped };
    if (options.requireSignature && candidateVector.length !== options.requireSignature.dim) {
        return { ranked: [], skipped };
    }

    const scored: RankedMemory[] = [];
    for (const memory of memories) {
        const embedding = memory.embedding;
        if (!embedding) {
            skipped.noEmbedding += 1;
            continue;
        }
        if (options.requireSignature && !signaturesMatch(embedding, options.requireSignature)) {
            skipped.signatureMismatch += 1;
            continue;
        }
        // Defensive: declared dim must match actual vector length.
        // A mismatch here means the row is corrupted or the adapter
        // is buggy; rank-and-pray would silently propagate the bug.
        if (embedding.vector.length !== embedding.dim) {
            skipped.corruptDim += 1;
            continue;
        }
        const similarity = cosineSimilarity(candidateVector, embedding.vector);
        if (!Number.isFinite(similarity)) {
            skipped.nonFiniteSimilarity += 1;
            continue;
        }
        scored.push({ memory, similarity });
    }
    scored.sort((a, b) => b.similarity - a.similarity);
    const ranked = scored.length <= options.topK ? scored : scored.slice(0, options.topK);
    return { ranked, skipped };
}
