import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeMemoryText } from "../src/memory/textNormalization.js";

describe("normalizeMemoryText", () => {
    it("returns empty for empty / whitespace input", () => {
        assert.equal(normalizeMemoryText(""), "");
        assert.equal(normalizeMemoryText("   "), "");
        assert.equal(normalizeMemoryText("\t\n\r "), "");
    });

    it("lowercases ASCII letters", () => {
        assert.equal(normalizeMemoryText("Hello World"), "hello world");
    });

    it("collapses runs of whitespace to a single space and trims", () => {
        assert.equal(normalizeMemoryText("  hello   world  "), "hello world");
        assert.equal(normalizeMemoryText("a\t\tb\n\nc"), "a b c");
    });

    it("folds full-width digits and letters via NFKC", () => {
        assert.equal(normalizeMemoryText("ＡＢＣ１２３"), "abc123");
    });

    it("normalizes curly quotes and dashes to ASCII", () => {
        assert.equal(normalizeMemoryText("“hello” – ‘world’"), "\"hello\" - 'world'");
    });

    it("folds ideographic and non-breaking spaces", () => {
        assert.equal(normalizeMemoryText("用户\u3000喜欢\u00A0游戏"), "用户 喜欢 游戏");
    });

    it("strips zero-width characters", () => {
        assert.equal(normalizeMemoryText("a\u200Bb\uFEFFc"), "abc");
    });

    it("is idempotent", () => {
        const once = normalizeMemoryText("  Hello,  “World”! ");
        assert.equal(normalizeMemoryText(once), once);
    });

    it("does not strip CJK content characters", () => {
        assert.equal(normalizeMemoryText("用户喜欢玩游戏"), "用户喜欢玩游戏");
    });

    it("handles non-string input defensively", () => {
        // @ts-expect-error intentional invalid input
        assert.equal(normalizeMemoryText(null), "");
        // @ts-expect-error intentional invalid input
        assert.equal(normalizeMemoryText(undefined), "");
    });
});
