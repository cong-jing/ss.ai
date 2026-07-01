import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MemoryCandidateRecorder } from "../src/memory/index.js";
import type { MemoryCandidateSource } from "../src/memory/index.js";
import {
    makeFixedClock,
    makeInMemoryMemoryStores,
    makeRecordingLogger,
    makeSequentialIds,
} from "./helpers/memoryFakes.js";

function makeSource(overrides: Partial<MemoryCandidateSource> = {}): MemoryCandidateSource {
    return {
        userId: "u1",
        characterId: "c1",
        conversationId: "conv1",
        userMessageId: "u-msg-1",
        assistantMessageId: "a-msg-1",
        requestId: "req-1",
        modelCallPurpose: "chat.main",
        ...overrides,
    };
}

describe("MemoryCandidateRecorder", () => {
    it("returns immediately for an empty candidate list and does not touch the store", async () => {
        const stores = makeInMemoryMemoryStores();
        const recorder = new MemoryCandidateRecorder({
            candidateStore: stores.candidateStore,
            clock: makeFixedClock(),
            ids: makeSequentialIds(),
        });

        const result = await recorder.recordCandidates({
            source: makeSource(),
            candidates: [],
        });

        assert.deepEqual(result.accepted, []);
        assert.equal(result.rejectedCount, 0);
        assert.equal(stores.candidateStore.snapshotAll().length, 0);
    });

    it("drops candidates whose text is empty / whitespace-only after trim", async () => {
        const stores = makeInMemoryMemoryStores();
        const recorder = new MemoryCandidateRecorder({
            candidateStore: stores.candidateStore,
            clock: makeFixedClock(),
            ids: makeSequentialIds(),
        });

        const result = await recorder.recordCandidates({
            source: makeSource(),
            candidates: [
                { scope: "user", type: "fact", text: "" },
                { scope: "user", type: "fact", text: "   \n\t  " },
                { scope: "user", type: "fact", text: "  User likes hiking.  " },
            ],
        });

        assert.equal(result.accepted.length, 1);
        assert.equal(result.rejectedCount, 2);
        // text is trimmed before persistence so downstream services
        // don't have to re-trim every time.
        assert.equal(result.accepted[0]!.text, "User likes hiking.");
    });

    it("persists every accepted candidate with source/seq filled in", async () => {
        const stores = makeInMemoryMemoryStores();
        const recorder = new MemoryCandidateRecorder({
            candidateStore: stores.candidateStore,
            clock: makeFixedClock(),
            ids: makeSequentialIds(),
        });
        const source = makeSource();

        const result = await recorder.recordCandidates({
            source,
            candidates: [
                { scope: "user", type: "fact", text: "用户喜欢玩游戏" },
                { scope: "user", type: "preference", text: "Hello World!" },
                { scope: "user", type: "fact", text: "Tokyo is great." },
            ],
        });

        assert.equal(result.accepted.length, 3);

        // source propagated verbatim onto every record
        for (const record of result.accepted) {
            assert.equal(record.source.userId, source.userId);
            assert.equal(record.source.assistantMessageId, source.assistantMessageId);
            assert.equal(record.source.requestId, source.requestId);
        }
        // seq is per-turn and monotonically increasing
        assert.deepEqual(result.accepted.map((r) => r.seq), [0, 1, 2]);
        // Recorder stores the trimmed text verbatim; normalization
        // moved to the staging processor in Batch 3.5.
        assert.equal(result.accepted[1]!.text, "Hello World!");
        // CJK text survives trim intact.
        assert.equal(result.accepted[0]!.text, "用户喜欢玩游戏");
    });

    it("isolates seq counters per assistant turn so concurrent turns don't collide", async () => {
        const stores = makeInMemoryMemoryStores();
        const recorder = new MemoryCandidateRecorder({
            candidateStore: stores.candidateStore,
            clock: makeFixedClock(),
            ids: makeSequentialIds(),
        });

        const turnA = await recorder.recordCandidates({
            source: makeSource({ assistantMessageId: "a-msg-A" }),
            candidates: [
                { scope: "user", type: "fact", text: "A1" },
                { scope: "user", type: "fact", text: "A2" },
            ],
        });
        const turnB = await recorder.recordCandidates({
            source: makeSource({ assistantMessageId: "a-msg-B" }),
            candidates: [
                { scope: "user", type: "fact", text: "B1" },
            ],
        });

        assert.deepEqual(turnA.accepted.map((r) => r.seq), [0, 1]);
        assert.deepEqual(turnB.accepted.map((r) => r.seq), [0]);
    });

    it("fail-soft when the store throws: warn, no rethrow, empty accepted, storeError set", async () => {
        const failure = new Error("simulated store outage");
        const stores = makeInMemoryMemoryStores({ candidateStore: { failOnAppend: failure } });
        const logger = makeRecordingLogger();
        const recorder = new MemoryCandidateRecorder({
            candidateStore: stores.candidateStore,
            clock: makeFixedClock(),
            ids: makeSequentialIds(),
            logger,
        });

        const result = await recorder.recordCandidates({
            source: makeSource(),
            candidates: [{ scope: "user", type: "fact", text: "still tries to record" }],
        });

        assert.deepEqual(result.accepted, []);
        assert.equal(result.storeError, failure);
        // the chat turn must NOT crash: store error is a warn, never a throw
        assert.equal(logger.warnEvents.length, 1);
        assert.match(logger.warnEvents[0]!.message, /store_error/);
    });

    it("returns only the records the store reports as saved", async () => {
        const stores = makeInMemoryMemoryStores();
        const recorder = new MemoryCandidateRecorder({
            candidateStore: stores.candidateStore,
            clock: makeFixedClock(),
            ids: makeSequentialIds(),
        });

        const result = await recorder.recordCandidates({
            source: makeSource(),
            candidates: [
                { scope: "user", type: "fact", text: "x" },
                { scope: "user", type: "fact", text: "y" },
            ],
        });

        // result.accepted must equal what's in the store, not the
        // input drafts (ids/timestamps/status come from the store).
        const persisted = stores.candidateStore.snapshotAll();
        assert.equal(result.accepted.length, persisted.length);
        for (let i = 0; i < persisted.length; i += 1) {
            assert.equal(result.accepted[i]!.id, persisted[i]!.id);
            assert.equal(result.accepted[i]!.status, "pending");
        }
    });
});
