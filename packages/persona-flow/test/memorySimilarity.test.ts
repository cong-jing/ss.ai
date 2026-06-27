import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    cosineSimilarity,
    rankSimilarMemories,
    type EmbeddingSignature,
} from "../src/memory/similarity.js";
import type { ActiveMemoryRecord, MemoryEmbedding } from "../src/memory/types.js";

const SIG: EmbeddingSignature = {
    provider: "fake",
    model: "fake-1",
    dim: 3,
    version: 1,
};

function embedding(vector: number[], overrides: Partial<MemoryEmbedding> = {}): MemoryEmbedding {
    return {
        vector,
        provider: SIG.provider,
        model: SIG.model,
        dim: SIG.dim,
        version: SIG.version,
        createdAt: "2024-01-01T00:00:00.000Z",
        ...overrides,
    };
}

function memory(id: string, text: string, vector?: number[], embeddingOverrides: Partial<MemoryEmbedding> = {}): ActiveMemoryRecord {
    return {
        id,
        userId: "u1",
        characterId: "c1",
        scope: "user",
        type: "fact",
        text,
        normalizedText: text,
        relatedEntities: [],
        tags: [],
        status: "active",
        importance: 0,
        embedding: vector ? embedding(vector, embeddingOverrides) : undefined,
        schemaVersion: 1,
        createdAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-01T00:00:00.000Z",
    };
}

describe("cosineSimilarity", () => {
    it("returns 1 for identical vectors", () => {
        assert.equal(cosineSimilarity([1, 2, 3], [1, 2, 3]), 1);
    });

    it("returns 0 for orthogonal vectors", () => {
        assert.equal(cosineSimilarity([1, 0, 0], [0, 1, 0]), 0);
    });

    it("returns -1 for antiparallel vectors", () => {
        assert.equal(cosineSimilarity([1, 0], [-1, 0]), -1);
    });

    it("returns NaN for mismatched length", () => {
        assert.equal(Number.isNaN(cosineSimilarity([1, 2], [1, 2, 3])), true);
    });

    it("returns NaN for empty vectors", () => {
        assert.equal(Number.isNaN(cosineSimilarity([], [])), true);
    });

    it("returns NaN for zero-norm vectors on either side", () => {
        assert.equal(Number.isNaN(cosineSimilarity([0, 0, 0], [1, 2, 3])), true);
        assert.equal(Number.isNaN(cosineSimilarity([1, 2, 3], [0, 0, 0])), true);
    });

    it("returns NaN for non-array input", () => {
        // @ts-expect-error intentional invalid input
        assert.equal(Number.isNaN(cosineSimilarity(null, [1])), true);
        // @ts-expect-error intentional invalid input
        assert.equal(Number.isNaN(cosineSimilarity([1], undefined)), true);
    });
});

describe("rankSimilarMemories", () => {
    it("sorts by similarity descending and respects topK", () => {
        const ranked = rankSimilarMemories(
            [1, 0, 0],
            [
                memory("m1", "A", [1, 0, 0]),
                memory("m2", "B", [0.9, 0.1, 0]),
                memory("m3", "C", [0, 1, 0]),
            ],
            { topK: 2, requireSignature: SIG },
        );
        assert.equal(ranked.length, 2);
        assert.equal(ranked[0]!.memory.id, "m1");
        assert.equal(ranked[1]!.memory.id, "m2");
    });

    it("skips memories without embeddings", () => {
        const ranked = rankSimilarMemories(
            [1, 0, 0],
            [
                memory("m1", "A"),
                memory("m2", "B", [1, 0, 0]),
            ],
            { topK: 5, requireSignature: SIG },
        );
        assert.equal(ranked.length, 1);
        assert.equal(ranked[0]!.memory.id, "m2");
    });

    it("skips memories whose embedding signature mismatches", () => {
        const ranked = rankSimilarMemories(
            [1, 0, 0],
            [
                memory("m1", "A", [1, 0, 0], { model: "other-model" }),
                memory("m2", "B", [1, 0, 0], { dim: 99 }),
                memory("m3", "C", [1, 0, 0], { provider: "other" }),
                memory("m4", "D", [1, 0, 0], { version: 99 }),
                memory("m5", "E", [1, 0, 0]),
            ],
            { topK: 5, requireSignature: SIG },
        );
        assert.deepEqual(
            ranked.map((r) => r.memory.id),
            ["m5"],
        );
    });

    it("skips entries whose cosine is non-finite (e.g. zero stored vector)", () => {
        const ranked = rankSimilarMemories(
            [1, 0, 0],
            [
                memory("m1", "A", [0, 0, 0]),
                memory("m2", "B", [1, 0, 0]),
            ],
            { topK: 5, requireSignature: SIG },
        );
        assert.equal(ranked.length, 1);
        assert.equal(ranked[0]!.memory.id, "m2");
    });

    it("returns empty when candidate vector is empty or topK <= 0", () => {
        const m = memory("m1", "A", [1, 0, 0]);
        assert.deepEqual(rankSimilarMemories([], [m], { topK: 5 }), []);
        assert.deepEqual(rankSimilarMemories([1, 0, 0], [m], { topK: 0 }), []);
    });

    it("allows skipping signature check when not provided", () => {
        const ranked = rankSimilarMemories(
            [1, 0, 0],
            [memory("m1", "A", [1, 0, 0], { model: "anything" })],
            { topK: 5 },
        );
        assert.equal(ranked.length, 1);
    });

    it("returns [] when candidate vector length disagrees with requireSignature.dim", () => {
        const ranked = rankSimilarMemories(
            [1, 0, 0, 0], // length 4 vs SIG.dim 3
            [memory("m1", "A", [1, 0, 0])],
            { topK: 5, requireSignature: SIG },
        );
        assert.deepEqual(ranked, []);
    });

    it("skips memories whose stored vector.length disagrees with embedding.dim", () => {
        const ranked = rankSimilarMemories(
            [1, 0, 0],
            [
                // declared dim 3 but vector length 4 -> corruption signal
                memory("m1", "A", [1, 0, 0, 0]),
                // matching, should rank
                memory("m2", "B", [1, 0, 0]),
                // declared dim 3 but vector length 2 -> also skipped
                memory("m3", "C", [1, 0]),
            ],
            { topK: 5, requireSignature: SIG },
        );
        assert.deepEqual(
            ranked.map((r) => r.memory.id),
            ["m2"],
        );
    });

    it("skips vector/dim mismatch even when no requireSignature is given", () => {
        const ranked = rankSimilarMemories(
            [1, 0, 0],
            [
                memory("m1", "A", [1, 0, 0, 0]),
                memory("m2", "B", [1, 0, 0]),
            ],
            { topK: 5 },
        );
        assert.deepEqual(
            ranked.map((r) => r.memory.id),
            ["m2"],
        );
    });
});
