import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { extractText, isMistralMessageContentEmpty } from "../src/mistral/messageTransforms.js";

describe("mistral message transforms", () => {
    it("treats missing or blank message content as empty", () => {
        assert.equal(isMistralMessageContentEmpty({}), true);
        assert.equal(isMistralMessageContentEmpty({ content: null }), true);
        assert.equal(isMistralMessageContentEmpty({ content: "   " }), true);
        assert.equal(isMistralMessageContentEmpty({ content: [] }), true);
        assert.equal(isMistralMessageContentEmpty({ content: [{ type: "text", text: "" }] }), true);
    });

    it("does not treat unknown non-empty content parts as empty", () => {
        const message = { content: [{ type: "unexpected", payload: "value" }] };
        const response = { choices: [{ message }] };

        assert.equal(isMistralMessageContentEmpty(message), false);
        assert.throws(() => extractText(response), /did not contain text content/i);
    });

    it("extracts text from string and array content", () => {
        assert.equal(extractText({ choices: [{ message: { content: "hello" } }] }), "hello");
        assert.equal(extractText({ choices: [{ message: { content: [{ type: "text", text: "hello" }, " world"] } }] }), "hello world");
    });
});