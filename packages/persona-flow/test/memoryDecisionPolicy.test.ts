import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    decideBySimilarity,
    defaultMemoryDecisionPolicy,
    isLowValueCandidate,
} from "../src/memory/decisionPolicy.js";
import type { RankedMemory } from "../src/memory/similarity.js";
import type { ActiveMemoryRecord } from "../src/memory/types.js";

function mem(id: string): ActiveMemoryRecord {
    return {
        id,
        userId: "u1",
        characterId: "c1",
        scope: "user",
        type: "fact",
        text: id,
        normalizedText: id,
        relatedEntities: [],
        tags: [],
        status: "active",
        importance: 0,
        schemaVersion: 1,
        createdAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-01T00:00:00.000Z",
    };
}

function rank(id: string, similarity: number): RankedMemory {
    return { memory: mem(id), similarity };
}

describe("decideBySimilarity", () => {
    it("returns create when no similar memories exist", () => {
        const d = decideBySimilarity([], defaultMemoryDecisionPolicy);
        assert.equal(d.kind, "create");
        assert.equal(d.reason, "no_similar_memories");
        assert.equal(d.topSimilarity, undefined);
    });

    it("returns create when top similarity is below needs-judge threshold", () => {
        const d = decideBySimilarity([rank("m1", 0.5)], defaultMemoryDecisionPolicy);
        assert.equal(d.kind, "create");
        assert.equal(d.topSimilarity, 0.5);
    });

    it("returns needs_judge when top similarity is at needs-judge threshold", () => {
        const d = decideBySimilarity([rank("m1", 0.80)], defaultMemoryDecisionPolicy);
        assert.equal(d.kind, "needs_judge");
        assert.equal(d.reason, "needs_judge_threshold");
    });

    it("returns needs_judge (not ignore_duplicate) when at exact-duplicate threshold", () => {
        const d = decideBySimilarity([rank("m1", 0.99)], defaultMemoryDecisionPolicy);
        assert.equal(d.kind, "needs_judge");
        assert.equal(d.reason, "exact_duplicate_threshold");
        assert.equal(d.topSimilarity, 0.99);
    });

    it("uses only the top entry to decide", () => {
        const d = decideBySimilarity(
            [rank("m1", 0.5), rank("m2", 0.99)],
            defaultMemoryDecisionPolicy,
        );
        // Caller is expected to pre-sort; the function trusts ranked[0].
        assert.equal(d.kind, "create");
        assert.equal(d.topSimilarity, 0.5);
    });

    it("honors custom policy thresholds", () => {
        const custom = {
            exactDuplicateThreshold: 0.99,
            needsJudgeThreshold: 0.6,
            topK: 5,
            policyVersion: 99,
        };
        assert.equal(decideBySimilarity([rank("m1", 0.7)], custom).kind, "needs_judge");
        assert.equal(decideBySimilarity([rank("m1", 0.5)], custom).kind, "create");
    });
});

describe("isLowValueCandidate", () => {
    it("flags empty / whitespace text", () => {
        const r = isLowValueCandidate({ text: "   ", scope: "user", type: "fact" });
        assert.equal(r.lowValue, true);
        assert.equal(r.reason, "empty_after_normalize");
    });

    it("flags single-character text as too short", () => {
        const r = isLowValueCandidate({ text: "a", scope: "user", type: "fact" });
        assert.equal(r.lowValue, true);
        assert.equal(r.reason, "too_short");
    });

    it("flags emoji-only / punctuation-only text", () => {
        const r = isLowValueCandidate({ text: "!!!???", scope: "user", type: "fact" });
        assert.equal(r.lowValue, true);
        assert.equal(r.reason, "no_letter_or_digit");
    });

    it("does not flag short but meaningful CJK content", () => {
        const r = isLowValueCandidate({ text: "东京", scope: "user", type: "fact" });
        assert.equal(r.lowValue, false);
    });

    it("does not flag normal English sentences", () => {
        const r = isLowValueCandidate({ text: "User likes hiking.", scope: "user", type: "fact" });
        assert.equal(r.lowValue, false);
    });
});
