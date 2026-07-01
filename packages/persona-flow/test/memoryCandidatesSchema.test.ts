import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    MemoryWriteCandidateSchema,
    SubmitMemoryCandidatesArgsSchema,
} from "@ss-ai/contracts/memoryCandidates.schema";

describe("memoryCandidates schema", () => {
    it("accepts a valid candidate for each scope", () => {
        const scopes = ["user", "character", "relationship", "conversation", "world"] as const;
        for (const scope of scopes) {
            const parsed = MemoryWriteCandidateSchema.safeParse({
                text: "Some stable fact.",
                scope,
                type: "fact",
            });
            assert.equal(parsed.success, true, `expected scope ${scope} to be accepted`);
        }
    });

    it("rejects empty text after trim", () => {
        const result = MemoryWriteCandidateSchema.safeParse({
            text: "   ",
            scope: "user",
            type: "fact",
        });
        assert.equal(result.success, false);
    });

    it("rejects unknown scope", () => {
        const result = MemoryWriteCandidateSchema.safeParse({
            text: "fact",
            scope: "session",
            type: "fact",
        });
        assert.equal(result.success, false);
    });

    it("rejects unknown candidate type", () => {
        const result = MemoryWriteCandidateSchema.safeParse({
            text: "fact",
            scope: "user",
            type: "rumor",
        });
        assert.equal(result.success, false);
    });

    it("accepts optional relatedEntities, tags, and reason", () => {
        const result = MemoryWriteCandidateSchema.safeParse({
            text: "User likes tea.",
            scope: "user",
            type: "preference",
            relatedEntities: ["user:default"],
            tags: ["beverage"],
            reason: "User stated this directly.",
        });
        assert.equal(result.success, true);
    });

    it("enforces the max candidate count of 5", () => {
        const candidates = Array.from({ length: 6 }, (_, i) => ({
            text: `fact ${i}`,
            scope: "user" as const,
            type: "fact" as const,
        }));
        const result = SubmitMemoryCandidatesArgsSchema.safeParse({ candidates });
        assert.equal(result.success, false);
    });

    it("accepts an empty candidate array", () => {
        const result = SubmitMemoryCandidatesArgsSchema.safeParse({ candidates: [] });
        assert.equal(result.success, true);
    });
});
