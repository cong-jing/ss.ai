import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { TurnEvent } from "@ss-ai/contracts";
import { getTurnEventsReplyText, mergeConsecutiveReplyTextEvents } from "../src/index.js";

describe("mergeConsecutiveReplyTextEvents", () => {
    it("collapses consecutive replyText events with the same characterId", () => {
        const events: TurnEvent[] = [
            { type: "replyText", characterId: "c1", text: "first" },
            { type: "replyText", characterId: "c1", text: "second" },
            { type: "replyText", characterId: "c1", text: "third" },
        ];
        const merged = mergeConsecutiveReplyTextEvents(events);
        assert.equal(merged.length, 1);
        assert.equal(merged[0].type, "replyText");
        assert.equal((merged[0] as Extract<TurnEvent, { type: "replyText" }>).text, "first\nsecond\nthird");
        assert.equal((merged[0] as Extract<TurnEvent, { type: "replyText" }>).characterId, "c1");
    });

    it("preserves order and does not merge across non-replyText events", () => {
        const events: TurnEvent[] = [
            { type: "replyText", characterId: "c1", text: "before" },
            { type: "expression", characterId: "c1", expression: "happy" },
            { type: "replyText", characterId: "c1", text: "after" },
        ];
        const merged = mergeConsecutiveReplyTextEvents(events);
        assert.equal(merged.length, 3);
        assert.equal(merged[0].type, "replyText");
        assert.equal(merged[1].type, "expression");
        assert.equal(merged[2].type, "replyText");
        assert.equal((merged[2] as Extract<TurnEvent, { type: "replyText" }>).text, "after");
    });

    it("does not merge replyText events from different characters", () => {
        const events: TurnEvent[] = [
            { type: "replyText", characterId: "c1", text: "alpha" },
            { type: "replyText", characterId: "c2", text: "beta" },
        ];
        const merged = mergeConsecutiveReplyTextEvents(events);
        assert.equal(merged.length, 2);
        assert.equal((merged[0] as Extract<TurnEvent, { type: "replyText" }>).text, "alpha");
        assert.equal((merged[1] as Extract<TurnEvent, { type: "replyText" }>).text, "beta");
    });

    it("returns an empty list unchanged", () => {
        assert.deepEqual(mergeConsecutiveReplyTextEvents([]), []);
    });

    it("does not mutate the original event objects", () => {
        const first = { type: "replyText" as const, characterId: "c1", text: "one" };
        const second = { type: "replyText" as const, characterId: "c1", text: "two" };
        const merged = mergeConsecutiveReplyTextEvents([first, second]);
        assert.equal(first.text, "one");
        assert.equal(second.text, "two");
        assert.equal((merged[0] as Extract<TurnEvent, { type: "replyText" }>).text, "one\ntwo");
    });

    it("agrees with getTurnEventsReplyText for the merged output", () => {
        const events: TurnEvent[] = [
            { type: "replyText", characterId: "c1", text: "  alpha  " },
            { type: "replyText", characterId: "c1", text: "beta" },
            { type: "expression", characterId: "c1", expression: "neutral" },
            { type: "replyText", characterId: "c1", text: "gamma" },
        ];
        const merged = mergeConsecutiveReplyTextEvents(events);
        // getTurnEventsReplyText trims each remaining replyText event and joins
        // with "\n" — after merging, the first event already contains its own
        // internal "\n" separator.
        assert.equal(getTurnEventsReplyText(merged), "alpha  \nbeta\ngamma");
    });
});
