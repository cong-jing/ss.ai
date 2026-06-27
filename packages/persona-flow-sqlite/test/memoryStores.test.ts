/**
 * SQLite memory store integration tests.
 *
 * Covers the three concrete stores added in Step 5:
 *   - SQLiteMemoryCandidateStore
 *   - SQLiteMemoryStore
 *   - SQLiteMemoryDecisionStore
 *
 * The goal is to lock down the storage contract (schema mapping,
 * JSON columns, character-bound isolation, embedding round-trip,
 * graceful handling of corrupt JSON). The commit pipeline already
 * has its own tests against the in-memory fakes; here we only check
 * that the SQLite adapters honour the ports the same way.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
    openDatabase,
    SQLiteMemoryCandidateStore,
    SQLiteMemoryStore,
    SQLiteMemoryDecisionStore,
    createSqliteStores,
} from "../src/index.js";
import { memoryCandidates, memories } from "../src/db/schema.js";
import { eq } from "drizzle-orm";
import type {
    MemoryCandidateSource,
    MemoryClock,
    MemoryEmbedding,
    MemoryIdGenerator,
    MemoryLogger,
} from "@ss-ai/persona-flow";

// ---------- helpers ----------

function makeClock(initial = "2026-02-01T00:00:00.000Z"): MemoryClock & { advance(ms: number): void } {
    let current = new Date(initial).getTime();
    return {
        nowIso: () => new Date(current).toISOString(),
        advance(ms: number) { current += ms; },
    };
}

function makeIds(prefix = "id"): MemoryIdGenerator {
    let n = 0;
    return { randomId: () => { n += 1; return `${prefix}-${n}`; } };
}

function makeRecordingLogger(): MemoryLogger & {
    debugCalls: Array<{ event: string; payload?: Record<string, unknown> }>;
    infoCalls: Array<{ event: string; payload?: Record<string, unknown> }>;
    warnCalls: Array<{ event: string; payload?: Record<string, unknown> }>;
    errorCalls: Array<{ event: string; payload?: Record<string, unknown> }>;
} {
    const debugCalls: Array<{ event: string; payload?: Record<string, unknown> }> = [];
    const infoCalls: Array<{ event: string; payload?: Record<string, unknown> }> = [];
    const warnCalls: Array<{ event: string; payload?: Record<string, unknown> }> = [];
    const errorCalls: Array<{ event: string; payload?: Record<string, unknown> }> = [];
    return {
        debug: (event, payload) => { debugCalls.push({ event, payload }); },
        info: (event, payload) => { infoCalls.push({ event, payload }); },
        warn: (event, payload) => { warnCalls.push({ event, payload }); },
        error: (event, payload) => { errorCalls.push({ event, payload }); },
        debugCalls,
        infoCalls,
        warnCalls,
        errorCalls,
    };
}

function makeSource(overrides: Partial<MemoryCandidateSource> = {}): MemoryCandidateSource {
    return {
        userId: "user-A",
        characterId: "char-A",
        conversationId: "conv-1",
        userMessageId: "umsg-1",
        assistantMessageId: "amsg-1",
        requestId: "req-1",
        modelCallPurpose: "chat.main",
        ...overrides,
    };
}

function makeEmbedding(vector: number[], overrides: Partial<MemoryEmbedding> = {}): MemoryEmbedding {
    return {
        vector,
        provider: "mistral",
        model: "embed-test",
        dim: vector.length,
        version: 1,
        createdAt: "2026-02-01T00:00:00.000Z",
        ...overrides,
    };
}

function freshStores() {
    const { db, sqlite } = openDatabase(":memory:");
    const clock = makeClock();
    const ids = makeIds();
    const logger = makeRecordingLogger();
    return {
        db,
        sqlite,
        clock,
        ids,
        logger,
        candidateStore: new SQLiteMemoryCandidateStore({ db, clock, ids, logger }),
        memoryStore: new SQLiteMemoryStore({ db, ids, logger }),
        decisionStore: new SQLiteMemoryDecisionStore({ db, ids, logger }),
    };
}

// ---------- candidate store ----------

describe("SQLiteMemoryCandidateStore — appendCandidates", () => {
    it("inserts multiple rows with monotonically increasing seq inside one assistant turn", async () => {
        const { candidateStore } = freshStores();
        const source = makeSource();
        const records = await candidateStore.appendCandidates({
            source,
            candidates: [
                { scope: "user", type: "fact", text: "alpha" },
                { scope: "user", type: "fact", text: "beta" },
                { scope: "user", type: "preference", text: "gamma" },
            ],
            normalizedTexts: ["alpha", "beta", "gamma"],
        });
        assert.equal(records.length, 3);
        assert.deepEqual(records.map((r) => r.seq), [0, 1, 2]);
        for (const r of records) {
            assert.equal(r.status, "pending");
            assert.equal(r.schemaVersion, 1);
            assert.equal(r.source.assistantMessageId, "amsg-1");
        }
    });

    it("continues seq across separate appendCandidates calls in the same assistant turn", async () => {
        const { candidateStore } = freshStores();
        const source = makeSource();
        await candidateStore.appendCandidates({
            source,
            candidates: [{ scope: "user", type: "fact", text: "first" }],
            normalizedTexts: ["first"],
        });
        const more = await candidateStore.appendCandidates({
            source,
            candidates: [
                { scope: "user", type: "fact", text: "second" },
                { scope: "user", type: "fact", text: "third" },
            ],
            normalizedTexts: ["second", "third"],
        });
        assert.deepEqual(more.map((r) => r.seq), [1, 2]);
    });

    it("rejects mismatched candidates / normalizedTexts length", async () => {
        const { candidateStore } = freshStores();
        await assert.rejects(
            () => candidateStore.appendCandidates({
                source: makeSource(),
                candidates: [
                    { scope: "user", type: "fact", text: "x" },
                    { scope: "user", type: "fact", text: "y" },
                ],
                normalizedTexts: ["only-one"],
            }),
            /normalizedTexts\.length/,
        );
    });
});

describe("SQLiteMemoryCandidateStore — listCandidates", () => {
    it("filters by conversationId, assistantMessageId, and status (single or array)", async () => {
        const { candidateStore } = freshStores();
        const sourceA = makeSource({ conversationId: "conv-1", assistantMessageId: "amsg-1" });
        const sourceB = makeSource({ conversationId: "conv-1", assistantMessageId: "amsg-2" });
        const sourceC = makeSource({ conversationId: "conv-2", assistantMessageId: "amsg-3" });
        await candidateStore.appendCandidates({
            source: sourceA,
            candidates: [
                { scope: "user", type: "fact", text: "a1" },
                { scope: "user", type: "fact", text: "a2" },
            ],
            normalizedTexts: ["a1", "a2"],
        });
        await candidateStore.appendCandidates({
            source: sourceB,
            candidates: [{ scope: "user", type: "fact", text: "b1" }],
            normalizedTexts: ["b1"],
        });
        await candidateStore.appendCandidates({
            source: sourceC,
            candidates: [{ scope: "user", type: "fact", text: "c1" }],
            normalizedTexts: ["c1"],
        });

        const byConv = await candidateStore.listCandidates({ userId: "user-A", conversationId: "conv-1" });
        assert.equal(byConv.length, 3);

        const byTurn = await candidateStore.listCandidates({ userId: "user-A", assistantMessageId: "amsg-1" });
        assert.deepEqual(byTurn.map((r) => r.text), ["a1", "a2"]);
        assert.deepEqual(byTurn.map((r) => r.seq), [0, 1]);

        const byStatusSingle = await candidateStore.listCandidates({ userId: "user-A", status: "pending" });
        assert.equal(byStatusSingle.length, 4);

        const byStatusArray = await candidateStore.listCandidates({
            userId: "user-A",
            status: ["pending", "committed"],
        });
        assert.equal(byStatusArray.length, 4);
    });

    it("honours the limit option", async () => {
        const { candidateStore } = freshStores();
        const source = makeSource();
        await candidateStore.appendCandidates({
            source,
            candidates: [
                { scope: "user", type: "fact", text: "1" },
                { scope: "user", type: "fact", text: "2" },
                { scope: "user", type: "fact", text: "3" },
            ],
            normalizedTexts: ["1", "2", "3"],
        });
        const got = await candidateStore.listCandidates({
            userId: "user-A",
            assistantMessageId: "amsg-1",
            limit: 2,
        });
        assert.equal(got.length, 2);
    });
});

describe("SQLiteMemoryCandidateStore — updateCandidateStatus / saveCandidateEmbedding", () => {
    it("updates status and reason", async () => {
        const { candidateStore } = freshStores();
        const [rec] = await candidateStore.appendCandidates({
            source: makeSource(),
            candidates: [{ scope: "user", type: "fact", text: "hi" }],
            normalizedTexts: ["hi"],
        });
        await candidateStore.updateCandidateStatus({
            candidateId: rec!.id,
            status: "commit_failed",
            reason: "policy:exceeds-importance-cap",
            updatedAt: "2026-02-02T00:00:00.000Z",
        });
        const got = await candidateStore.listCandidates({ userId: "user-A", assistantMessageId: "amsg-1" });
        assert.equal(got[0]!.status, "commit_failed");
        assert.equal(got[0]!.reason, "policy:exceeds-importance-cap");
        assert.equal(got[0]!.updatedAt, "2026-02-02T00:00:00.000Z");
    });

    it("saveCandidateEmbedding writes the embedding and flips status to embedded", async () => {
        const { candidateStore } = freshStores();
        const [rec] = await candidateStore.appendCandidates({
            source: makeSource(),
            candidates: [{ scope: "user", type: "fact", text: "hi" }],
            normalizedTexts: ["hi"],
        });
        const embedding = makeEmbedding([0.1, 0.2, 0.3, 0.4]);
        await candidateStore.saveCandidateEmbedding({
            candidateId: rec!.id,
            embedding,
            updatedAt: "2026-02-02T00:00:00.000Z",
        });
        const got = await candidateStore.listCandidates({ userId: "user-A", assistantMessageId: "amsg-1" });
        assert.equal(got[0]!.status, "embedded");
        assert.ok(got[0]!.embedding, "embedding should round-trip");
        assert.deepEqual(got[0]!.embedding!.vector, [0.1, 0.2, 0.3, 0.4]);
        assert.equal(got[0]!.embedding!.provider, "mistral");
        assert.equal(got[0]!.embedding!.dim, 4);
    });
});

// ---------- memory store ----------

describe("SQLiteMemoryStore — createMemory + listActiveMemories", () => {
    it("filters by user/character/scope/type/status, scoped to one character world", async () => {
        const { memoryStore } = freshStores();
        const baseInput = {
            userId: "user-A",
            normalizedText: "x",
            relatedEntities: [],
            tags: [],
            importance: 0.5,
            createdAt: "2026-02-01T00:00:00.000Z",
            updatedAt: "2026-02-01T00:00:00.000Z",
        };
        await memoryStore.createMemory({
            ...baseInput,
            characterId: "char-A",
            scope: "character",
            type: "fact",
            text: "ch-A fact",
            normalizedText: "ch-A fact",
        });
        await memoryStore.createMemory({
            ...baseInput,
            characterId: "char-B",
            scope: "character",
            type: "fact",
            text: "ch-B fact",
            normalizedText: "ch-B fact",
        });
        // `scope: "user"` is still bound to a character world: it
        // classifies a fact about the user *inside* that character
        // world, it does not let memories cross characters.
        await memoryStore.createMemory({
            ...baseInput,
            characterId: "char-A",
            scope: "user",
            type: "preference",
            text: "user pref under char-A",
            normalizedText: "user pref under char-A",
        });
        // `scope: "world"` is also character-bound: it represents
        // worldbuilding facts inside one character world.
        await memoryStore.createMemory({
            ...baseInput,
            characterId: "char-B",
            scope: "world",
            type: "fact",
            text: "world fact under char-B",
            normalizedText: "world fact under char-B",
        });

        const onlyCharA = await memoryStore.listActiveMemories({ userId: "user-A", characterId: "char-A" });
        assert.deepEqual(
            onlyCharA.map((m) => m.text).sort(),
            ["ch-A fact", "user pref under char-A"].sort(),
        );
        for (const m of onlyCharA) {
            assert.equal(m.characterId, "char-A", "memory must always carry the character it belongs to");
        }

        const onlyCharB = await memoryStore.listActiveMemories({ userId: "user-A", characterId: "char-B" });
        assert.deepEqual(
            onlyCharB.map((m) => m.text).sort(),
            ["ch-B fact", "world fact under char-B"].sort(),
        );

        // Filtering by scope/type still applies inside the character bucket.
        const userScope = await memoryStore.listActiveMemories({
            userId: "user-A",
            characterId: "char-A",
            scope: "user",
            type: "preference",
            status: "active",
        });
        assert.equal(userScope.length, 1);
        assert.equal(userScope[0]!.text, "user pref under char-A");

        const scopedArrays = await memoryStore.listActiveMemories({
            userId: "user-A",
            characterId: "char-A",
            scope: ["character", "user"],
            type: ["fact", "preference"],
            status: ["active"],
        });
        assert.equal(scopedArrays.length, 2);
    });

    it("same user + same scope/type + same normalizedText but different character live as separate memories", async () => {
        const { memoryStore } = freshStores();
        const base = {
            userId: "user-A",
            scope: "user" as const,
            type: "preference" as const,
            text: "User likes coffee",
            normalizedText: "user likes coffee",
            relatedEntities: [],
            tags: [],
            importance: 0.5,
            createdAt: "2026-02-01T00:00:00.000Z",
            updatedAt: "2026-02-01T00:00:00.000Z",
        };
        await memoryStore.createMemory({ ...base, characterId: "char-A" });
        await memoryStore.createMemory({ ...base, characterId: "char-B" });

        const onA = await memoryStore.listActiveMemories({ userId: "user-A", characterId: "char-A" });
        assert.equal(onA.length, 1);
        assert.equal(onA[0]!.characterId, "char-A");

        const onB = await memoryStore.listActiveMemories({ userId: "user-A", characterId: "char-B" });
        assert.equal(onB.length, 1);
        assert.equal(onB[0]!.characterId, "char-B");
    });

    it("orders by updatedAt DESC, createdAt DESC, id ASC so `limit` truncates the oldest rows", async () => {
        const { memoryStore } = freshStores();
        const base = {
            userId: "user-A",
            characterId: "char-A",
            scope: "character" as const,
            type: "fact" as const,
            relatedEntities: [],
            tags: [],
            importance: 0.5,
        };
        // Insert in non-monotonic order to prove the order does not
        // come from row insertion. updatedAt is the primary sort key:
        // we expect [m-new, m-mid, m-old] regardless of insertion order.
        await memoryStore.createMemory({
            ...base,
            text: "mid",
            normalizedText: "mid",
            createdAt: "2026-01-02T00:00:00.000Z",
            updatedAt: "2026-01-02T00:00:00.000Z",
        });
        await memoryStore.createMemory({
            ...base,
            text: "old",
            normalizedText: "old",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
        });
        await memoryStore.createMemory({
            ...base,
            text: "new",
            normalizedText: "new",
            createdAt: "2026-01-03T00:00:00.000Z",
            updatedAt: "2026-01-03T00:00:00.000Z",
        });

        const all = await memoryStore.listActiveMemories({ userId: "user-A", characterId: "char-A" });
        assert.deepEqual(all.map((m) => m.text), ["new", "mid", "old"]);

        // With limit smaller than the bucket, the newest survive and
        // the oldest gets dropped — this is what the commit service
        // relies on to keep similarity scans reproducible.
        const capped = await memoryStore.listActiveMemories({ userId: "user-A", characterId: "char-A", limit: 2 });
        assert.deepEqual(capped.map((m) => m.text), ["new", "mid"]);
    });

    it("uses id ASC as a tiebreaker when updatedAt and createdAt are identical", async () => {
        const { db } = openDatabase(":memory:");
        const ids = makeIds("tie");
        const memoryStore = new SQLiteMemoryStore({ db, ids });
        const sameTs = "2026-04-01T00:00:00.000Z";
        const base = {
            userId: "user-A",
            characterId: "char-A",
            scope: "character" as const,
            type: "fact" as const,
            relatedEntities: [],
            tags: [],
            importance: 0.5,
            createdAt: sameTs,
            updatedAt: sameTs,
        };
        // Inserting in reverse-id order: ids will be tie-1, tie-2, tie-3
        // because the id generator advances on each createMemory; we
        // want the read order to come back in id-ASC order regardless.
        await memoryStore.createMemory({ ...base, text: "first", normalizedText: "first" });
        await memoryStore.createMemory({ ...base, text: "second", normalizedText: "second" });
        await memoryStore.createMemory({ ...base, text: "third", normalizedText: "third" });

        const all = await memoryStore.listActiveMemories({ userId: "user-A", characterId: "char-A" });
        // id-ASC ⇒ insertion order ⇒ ["first", "second", "third"]
        assert.deepEqual(all.map((m) => m.text), ["first", "second", "third"]);
    });
});

describe("SQLiteMemoryStore — findExactActiveMemory", () => {
    it("matches normalized text inside one character bucket and never crosses characters", async () => {
        const { memoryStore } = freshStores();
        await memoryStore.createMemory({
            userId: "user-A",
            characterId: "char-A",
            scope: "character",
            type: "fact",
            text: "Likes apples",
            normalizedText: "likes apples",
            relatedEntities: [],
            tags: [],
            importance: 0.5,
            createdAt: "2026-02-01T00:00:00.000Z",
            updatedAt: "2026-02-01T00:00:00.000Z",
        });
        await memoryStore.createMemory({
            userId: "user-A",
            characterId: "char-A",
            scope: "user",
            type: "preference",
            text: "Likes apples",
            normalizedText: "likes apples",
            relatedEntities: [],
            tags: [],
            importance: 0.5,
            createdAt: "2026-02-01T00:00:00.000Z",
            updatedAt: "2026-02-01T00:00:00.000Z",
        });

        const hitChar = await memoryStore.findExactActiveMemory({
            userId: "user-A",
            characterId: "char-A",
            scope: "character",
            type: "fact",
            normalizedText: "likes apples",
        });
        assert.ok(hitChar);
        assert.equal(hitChar!.scope, "character");
        assert.equal(hitChar!.characterId, "char-A");

        const hitUser = await memoryStore.findExactActiveMemory({
            userId: "user-A",
            characterId: "char-A",
            scope: "user",
            type: "preference",
            normalizedText: "likes apples",
        });
        assert.ok(hitUser);
        assert.equal(hitUser!.scope, "user");
        assert.equal(hitUser!.characterId, "char-A");

        // Same user / same scope / same normalizedText, but a
        // different character → must miss. char-A's memories never
        // leak into char-B's bucket.
        const missOtherCharacter = await memoryStore.findExactActiveMemory({
            userId: "user-A",
            characterId: "char-B",
            scope: "user",
            type: "preference",
            normalizedText: "likes apples",
        });
        assert.equal(missOtherCharacter, undefined);

        // Same normalized text but a different scope/type should miss.
        const missScope = await memoryStore.findExactActiveMemory({
            userId: "user-A",
            characterId: "char-A",
            scope: "world",
            type: "fact",
            normalizedText: "likes apples",
        });
        assert.equal(missScope, undefined);
    });
});

describe("SQLiteMemoryStore — saveMemoryEmbedding", () => {
    it("round-trips an embedding through the JSON column", async () => {
        const { memoryStore } = freshStores();
        const created = await memoryStore.createMemory({
            userId: "user-A",
            characterId: "char-A",
            scope: "user",
            type: "fact",
            text: "x",
            normalizedText: "x",
            relatedEntities: [],
            tags: [],
            importance: 0.5,
            createdAt: "2026-02-01T00:00:00.000Z",
            updatedAt: "2026-02-01T00:00:00.000Z",
        });
        const embedding = makeEmbedding([0.5, 0.5]);
        await memoryStore.saveMemoryEmbedding({
            memoryId: created.id,
            embedding,
            updatedAt: "2026-02-03T00:00:00.000Z",
        });
        const got = await memoryStore.listActiveMemories({ userId: "user-A", characterId: "char-A" });
        assert.equal(got.length, 1);
        assert.deepEqual(got[0]!.embedding?.vector, [0.5, 0.5]);
        assert.equal(got[0]!.updatedAt, "2026-02-03T00:00:00.000Z");
    });
});

// ---------- decision store ----------

describe("SQLiteMemoryDecisionStore", () => {
    it("persists similarity entries as JSON and round-trips them on read", async () => {
        const { decisionStore } = freshStores();
        const created = await decisionStore.appendDecision({
            candidateId: "cand-1",
            userId: "user-A",
            characterId: "char-A",
            decision: "create",
            memoryId: "mem-1",
            similarity: [
                { memoryId: "mem-old", similarity: 0.42, text: "old text" },
                { memoryId: "mem-other", similarity: 0.18, text: "other text" },
            ],
            policyVersion: 1,
            createdAt: "2026-02-04T00:00:00.000Z",
        });
        assert.equal(created.id.length > 0, true);
        const got = await decisionStore.listDecisions({ userId: "user-A" });
        assert.equal(got.length, 1);
        assert.equal(got[0]!.decision, "create");
        assert.equal(got[0]!.memoryId, "mem-1");
        assert.equal(got[0]!.similarity.length, 2);
        assert.equal(got[0]!.similarity[0]!.memoryId, "mem-old");
        assert.equal(got[0]!.similarity[0]!.similarity, 0.42);
    });

    it("filters by candidateId and by decision kind (single or array)", async () => {
        const { decisionStore } = freshStores();
        const base = {
            userId: "user-A",
            characterId: "char-A",
            policyVersion: 1,
            similarity: [],
            createdAt: "2026-02-04T00:00:00.000Z",
        } as const;
        await decisionStore.appendDecision({ ...base, candidateId: "c1", decision: "create", memoryId: "m1" });
        await decisionStore.appendDecision({ ...base, candidateId: "c2", decision: "ignore_duplicate" });
        await decisionStore.appendDecision({ ...base, candidateId: "c3", decision: "ignore_low_value" });

        const onlyC1 = await decisionStore.listDecisions({ userId: "user-A", candidateId: "c1" });
        assert.equal(onlyC1.length, 1);

        const onlyCreate = await decisionStore.listDecisions({ userId: "user-A", decision: "create" });
        assert.equal(onlyCreate.length, 1);

        const ignored = await decisionStore.listDecisions({
            userId: "user-A",
            decision: ["ignore_duplicate", "ignore_low_value"],
        });
        assert.equal(ignored.length, 2);
    });
});

// ---------- corrupt JSON ----------

describe("Memory stores — corrupt JSON columns", () => {
    it("memory_candidates: returns the row with no embedding and warns when embedding_json is malformed", async () => {
        const { db, candidateStore, logger } = freshStores();
        const [rec] = await candidateStore.appendCandidates({
            source: makeSource(),
            candidates: [{ scope: "user", type: "fact", text: "hi" }],
            normalizedTexts: ["hi"],
        });
        // Inject a corrupt embedding_json directly (bypass the store).
        await db
            .update(memoryCandidates)
            .set({ embeddingJson: "{not json" })
            .where(eq(memoryCandidates.id, rec!.id));

        const got = await candidateStore.listCandidates({ userId: "user-A", assistantMessageId: "amsg-1" });
        assert.equal(got.length, 1);
        assert.equal(got[0]!.embedding, undefined);
        assert.ok(
            logger.warnCalls.some((c) => c.event === "memory.sqlite.json_parse_failed"),
            "expected a json_parse_failed warning",
        );
    });

    it("memories: returns the row with no embedding when the JSON shape is invalid", async () => {
        const { db, memoryStore, logger } = freshStores();
        const created = await memoryStore.createMemory({
            userId: "user-A",
            characterId: "char-A",
            scope: "user",
            type: "fact",
            text: "x",
            normalizedText: "x",
            relatedEntities: [],
            tags: [],
            importance: 0.5,
            createdAt: "2026-02-01T00:00:00.000Z",
            updatedAt: "2026-02-01T00:00:00.000Z",
        });
        // Valid JSON but wrong shape (missing required fields).
        await db
            .update(memories)
            .set({ embeddingJson: JSON.stringify({ vector: [0.1] }) })
            .where(eq(memories.id, created.id));

        const got = await memoryStore.listActiveMemories({ userId: "user-A", characterId: "char-A" });
        assert.equal(got.length, 1);
        assert.equal(got[0]!.embedding, undefined);
        assert.ok(
            logger.warnCalls.some((c) => c.event.startsWith("memory.sqlite.embedding_")),
            "expected an embedding_* warning",
        );
    });
});

// ---------- createSqliteStores wiring ----------

describe("createSqliteStores — memory store wiring", () => {
    it("wires SQLite memory stores onto AppStores even when no characterDbDir is provided", async () => {
        const { db } = openDatabase(":memory:");
        const stores = createSqliteStores({
            db,
            memoryClock: makeClock(),
            memoryIds: makeIds("wired"),
        });
        // Smoke test all three keys exist and behave.
        const candRecords = await stores.memoryCandidate.appendCandidates({
            source: makeSource(),
            candidates: [{ scope: "user", type: "fact", text: "wired" }],
            normalizedTexts: ["wired"],
        });
        assert.equal(candRecords.length, 1);
        const mem = await stores.memory.createMemory({
            userId: "user-A",
            characterId: "char-A",
            scope: "user",
            type: "fact",
            text: "wired",
            normalizedText: "wired",
            relatedEntities: [],
            tags: [],
            importance: 0.5,
            createdAt: "2026-02-01T00:00:00.000Z",
            updatedAt: "2026-02-01T00:00:00.000Z",
        });
        const decision = await stores.memoryDecision.appendDecision({
            candidateId: candRecords[0]!.id,
            userId: "user-A",
            characterId: "char-A",
            decision: "create",
            memoryId: mem.id,
            similarity: [],
            policyVersion: 1,
            createdAt: "2026-02-01T00:00:00.000Z",
        });
        assert.equal(decision.decision, "create");
        assert.equal(decision.memoryId, mem.id);
    });
});
