import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SubmitTurnEventsArgsSchema } from "@ss-ai/contracts/turnEvents.schema";

function validReplyTextEvent() {
    return { type: "replyText" as const, characterId: "c1", text: "hello" };
}

function validCandidate(text = "User lives in Tokyo.") {
    return { text, scope: "user" as const, type: "fact" as const };
}

describe("SubmitTurnEventsArgsSchema", () => {
    it("accepts events plus memoryWriteCandidates", () => {
        const result = SubmitTurnEventsArgsSchema.safeParse({
            events: [validReplyTextEvent()],
            memoryWriteCandidates: [validCandidate(), validCandidate("User likes hiking.")],
        });
        assert.equal(result.success, true);
        if (result.success) {
            assert.equal(result.data.events.length, 1);
            assert.equal(result.data.memoryWriteCandidates?.length, 2);
        }
    });

    it("accepts events without memoryWriteCandidates", () => {
        const result = SubmitTurnEventsArgsSchema.safeParse({
            events: [validReplyTextEvent()],
        });
        assert.equal(result.success, true);
        if (result.success) {
            assert.equal(result.data.memoryWriteCandidates, undefined);
        }
    });

    it("accepts events with an empty memoryWriteCandidates array", () => {
        // The schema does not require .min(1) on candidates because batch 1
        // intentionally accepts both omission and empty arrays; the prompt
        // tells the model to omit instead, but we must not crash on either.
        const result = SubmitTurnEventsArgsSchema.safeParse({
            events: [validReplyTextEvent()],
            memoryWriteCandidates: [],
        });
        assert.equal(result.success, true);
    });

    it("rejects more than 5 memoryWriteCandidates", () => {
        const result = SubmitTurnEventsArgsSchema.safeParse({
            events: [validReplyTextEvent()],
            memoryWriteCandidates: [
                validCandidate("a"),
                validCandidate("b"),
                validCandidate("c"),
                validCandidate("d"),
                validCandidate("e"),
                validCandidate("f"),
            ],
        });
        assert.equal(result.success, false);
    });

    it("rejects invalid memoryWriteCandidate entries (empty text)", () => {
        const result = SubmitTurnEventsArgsSchema.safeParse({
            events: [validReplyTextEvent()],
            memoryWriteCandidates: [
                { text: "", scope: "user", type: "fact" },
            ],
        });
        assert.equal(result.success, false);
    });

    it("rejects invalid memoryWriteCandidate entries (unknown scope)", () => {
        const result = SubmitTurnEventsArgsSchema.safeParse({
            events: [validReplyTextEvent()],
            memoryWriteCandidates: [
                { text: "x", scope: "galaxy", type: "fact" },
            ],
        });
        assert.equal(result.success, false);
    });

    it("rejects unknown top-level keys (strict mode)", () => {
        const result = SubmitTurnEventsArgsSchema.safeParse({
            events: [validReplyTextEvent()],
            unexpectedField: "nope",
        });
        assert.equal(result.success, false);
    });

    it("rejects empty events array", () => {
        const result = SubmitTurnEventsArgsSchema.safeParse({
            events: [],
            memoryWriteCandidates: [validCandidate()],
        });
        assert.equal(result.success, false);
    });
});
