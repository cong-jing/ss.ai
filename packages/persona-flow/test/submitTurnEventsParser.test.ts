import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseSubmitTurnEventsArgs, safeParseSubmitTurnEventsArgs } from "../src/index.js";

describe("submit turn events parser", () => {
    it("parses JSON string arguments", () => {
        const parsed = parseSubmitTurnEventsArgs(JSON.stringify({
            events: [
                { type: "replyText", characterId: "c1", text: "hello" },
            ],
        }));

        assert.equal(parsed.events.length, 1);
        assert.equal(parsed.events[0].type, "replyText");
    });

    it("parses object arguments", () => {
        const parsed = parseSubmitTurnEventsArgs({
            events: [
                { type: "sceneAtmosphere", atmosphere: "calm" },
            ],
        });

        assert.equal(parsed.events[0].type, "sceneAtmosphere");
    });

    it("returns safe parse errors", () => {
        const result = safeParseSubmitTurnEventsArgs({ events: [] });

        assert.equal(result.success, false);
        if (!result.success) {
            assert.match(result.error.message, /too small|at least/i);
        }
    });

    it("returns a clear error when tool arguments are missing", () => {
        const result = safeParseSubmitTurnEventsArgs(undefined);

        assert.equal(result.success, false);
        if (!result.success) {
            assert.match(result.error.message, /arguments missing/i);
        }
    });
});
