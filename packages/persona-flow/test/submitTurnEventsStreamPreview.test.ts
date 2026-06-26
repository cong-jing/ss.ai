import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createSubmitTurnEventsPreviewParser, type SubmitTurnEventsPreviewEvent } from "../src/chatTurn/events/submitTurnEventsStreamPreview.js";

function pushAll(parser: ReturnType<typeof createSubmitTurnEventsPreviewParser>, chunks: string[]): SubmitTurnEventsPreviewEvent[] {
    const events: SubmitTurnEventsPreviewEvent[] = [];
    for (const chunk of chunks) {
        for (const event of parser.push(chunk)) {
            events.push(event);
        }
    }
    return events;
}

describe("submitTurnEventsStreamPreview", () => {
    it("emits replyTextDelta for incremental replyText.text", () => {
        const parser = createSubmitTurnEventsPreviewParser();
        const args = '{"events":[{"type":"replyText","characterId":"c1","text":"Hello World"}]}';
        // Split into small fragments to force partial reads
        const chunks: string[] = [];
        for (let i = 0; i < args.length; i += 5) chunks.push(args.slice(i, i + 5));

        const events = pushAll(parser, chunks);

        const deltas = events.filter(e => e.type === "replyTextDelta");
        assert.ok(deltas.length > 0, `expected at least one replyTextDelta, got ${JSON.stringify(events)}`);
        const text = deltas.map(d => (d as { text: string }).text).join("");
        assert.equal(text, "Hello World");

        const previews = events.filter(e => e.type === "turnEventPreview");
        assert.equal(previews.length, 1);
        assert.equal((previews[0] as { eventIndex: number }).eventIndex, 0);
    });

    it("decodes JSON escapes inside replyText.text", () => {
        const parser = createSubmitTurnEventsPreviewParser();
        // raw JSON arguments string contains \n and \\ escapes
        const args = '{"events":[{"type":"replyText","characterId":"c1","text":"a\\nb\\\\c"}]}';

        const events = parser.push(args);
        const deltas = events.filter(e => e.type === "replyTextDelta");
        const text = deltas.map(d => (d as { text: string }).text).join("");
        assert.equal(text, "a\nb\\c");
    });

    it("waits for a complete \\uXXXX escape before emitting", () => {
        const parser = createSubmitTurnEventsPreviewParser();
        const head = '{"events":[{"type":"replyText","characterId":"c1","text":"';
        // chinese char U+4F60 (你)
        const chunks = [head, "\\u4", "F60\"}]}"];

        const events = pushAll(parser, chunks);
        const deltas = events.filter(e => e.type === "replyTextDelta");
        const text = deltas.map(d => (d as { text: string }).text).join("");
        assert.equal(text, "你");
    });

    it("emits expression event preview when its object closes", () => {
        const parser = createSubmitTurnEventsPreviewParser();
        const args = JSON.stringify({
            events: [
                { type: "expression", characterId: "c1", expression: "happy" },
            ],
        });

        const events = parser.push(args);
        const previews = events.filter(e => e.type === "turnEventPreview");
        assert.equal(previews.length, 1);
        const preview = previews[0] as { eventIndex: number; event: { type: string; characterId?: string; expression?: string } };
        assert.equal(preview.eventIndex, 0);
        assert.equal(preview.event.type, "expression");
        assert.equal(preview.event.expression, "happy");
    });

    it("does not emit replyTextDelta when text appears before type=replyText", () => {
        const parser = createSubmitTurnEventsPreviewParser();
        // text key precedes type key — we cannot know it's a replyText.text value
        const args = '{"events":[{"text":"Hi","type":"replyText","characterId":"c1"}]}';

        const events = parser.push(args);
        const deltas = events.filter(e => e.type === "replyTextDelta");
        assert.equal(deltas.length, 0);
        // Full event preview still validates and emits
        const previews = events.filter(e => e.type === "turnEventPreview");
        assert.equal(previews.length, 1);
    });

    it("stops emitting previews on malformed JSON but does not throw", () => {
        const parser = createSubmitTurnEventsPreviewParser();
        // missing closing quote and brace, then random text
        const events = parser.push('{"events":[{"type":"replyText","characterId":"c1","text":"hi"!]}');
        // We don't assert specific counts: only that pushing didn't throw and
        // returned an array.
        assert.ok(Array.isArray(events));
    });

    it("tracks event indices across multiple events", () => {
        const parser = createSubmitTurnEventsPreviewParser();
        const args = JSON.stringify({
            events: [
                { type: "replyText", characterId: "c1", text: "first" },
                { type: "expression", characterId: "c1", expression: "happy" },
                { type: "sceneAtmosphere", atmosphere: "calm" },
            ],
        });

        const events = parser.push(args);
        const previews = events.filter(e => e.type === "turnEventPreview") as Array<{ eventIndex: number; event: { type: string } }>;
        assert.deepEqual(
            previews.map(p => ({ index: p.eventIndex, type: p.event.type })),
            [
                { index: 0, type: "replyText" },
                { index: 1, type: "expression" },
                { index: 2, type: "sceneAtmosphere" },
            ],
        );

        const deltas = events.filter(e => e.type === "replyTextDelta") as Array<{ eventIndex: number; text: string }>;
        const firstText = deltas.filter(d => d.eventIndex === 0).map(d => d.text).join("");
        assert.equal(firstText, "first");
    });

    it("handles split fragments mid-escape", () => {
        const parser = createSubmitTurnEventsPreviewParser();
        const head = '{"events":[{"type":"replyText","characterId":"c1","text":"line1';
        const tail = '\\nline2"}]}';
        // Split tail at the backslash so push lands on a pending escape
        const events = pushAll(parser, [head, "\\", "nline2\"}]}"]);
        const deltas = events.filter(e => e.type === "replyTextDelta") as Array<{ text: string }>;
        const text = deltas.map(d => d.text).join("");
        assert.equal(text, "line1\nline2");
        // Just reference `tail` so it isn't flagged as unused.
        void tail;
    });

    it("ignores a top-level memoryWriteCandidates field placed before events", () => {
        // Memory candidates are a fail-soft sibling of `events` inside the
        // same structured-output JSON. They must never feed into the
        // assistant display stream or appear as turnEventPreview entries.
        const parser = createSubmitTurnEventsPreviewParser();
        const args = JSON.stringify({
            memoryWriteCandidates: [
                { text: "User lives in Tokyo.", scope: "user", type: "fact" },
            ],
            events: [
                { type: "replyText", characterId: "c1", text: "hello" },
            ],
        });

        // Feed in small fragments to force partial reads across the
        // memoryWriteCandidates boundary.
        const chunks: string[] = [];
        for (let i = 0; i < args.length; i += 5) chunks.push(args.slice(i, i + 5));

        const events = pushAll(parser, chunks);

        const deltas = events.filter(e => e.type === "replyTextDelta");
        const text = deltas.map(d => (d as { text: string }).text).join("");
        assert.equal(text, "hello", "candidate text must not leak into the display stream");

        const previews = events.filter(e => e.type === "turnEventPreview");
        assert.equal(previews.length, 1);
        assert.equal((previews[0] as { eventIndex: number }).eventIndex, 0);
        assert.equal((previews[0] as { event: { type: string } }).event.type, "replyText");
    });

    it("ignores a top-level memoryWriteCandidates field placed after events", () => {
        const parser = createSubmitTurnEventsPreviewParser();
        const args = JSON.stringify({
            events: [
                { type: "replyText", characterId: "c1", text: "hi" },
                { type: "expression", characterId: "c1", expression: "happy" },
            ],
            memoryWriteCandidates: [
                { text: "User likes hiking.", scope: "user", type: "preference" },
                { text: "Conversation started 2026-06-26.", scope: "conversation", type: "event" },
            ],
        });

        const chunks: string[] = [];
        for (let i = 0; i < args.length; i += 7) chunks.push(args.slice(i, i + 7));

        const events = pushAll(parser, chunks);

        const deltas = events.filter(e => e.type === "replyTextDelta");
        const text = deltas.map(d => (d as { text: string }).text).join("");
        assert.equal(text, "hi");

        const previews = events.filter(e => e.type === "turnEventPreview");
        // Two events (replyText, expression). No candidate-derived previews.
        assert.equal(previews.length, 2);
        const eventTypes = previews.map(p => (p as { event: { type: string } }).event.type);
        assert.deepEqual(eventTypes.sort(), ["expression", "replyText"]);
    });
});
