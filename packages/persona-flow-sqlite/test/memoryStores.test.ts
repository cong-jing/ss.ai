/**
 * SQLite memory store integration tests (Batch 3.5).
 *
 * Covers the three concrete stores after the staging refactor:
 *   - SQLiteMemoryCandidateStore      (intake + listPendingCandidates + status updates)
 *   - SQLiteMemoryStagingStore        (find/create/link/incrementOccurrence/list)
 *   - SQLiteMemoryRetainedStore       (read-only list; table empty in 3.5)
 *
 * The goal is to lock down the storage contract (schema mapping,
 * JSON columns, embedding round-trip, transactional create, UNIQUE
 * constraint on candidate_id, graceful handling of corrupt JSON).
 * The staging processor and pipeline tests already cover behavioural
 * orchestration against in-memory fakes — here we only check that
 * the SQLite adapters honour the ports the same way.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
    createSqliteStores,
    openDatabase,
    SQLiteMemoryCandidateStore,
    SQLiteMemoryConsolidationDecisionStore,
    SQLiteMemoryRetainedStore,
    SQLiteMemoryStagingStore,
} from "../src/index.js";
import { memoryCandidates, memoryStaging, memoryStagingSources } from "../src/db/schema.js";
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

interface RecordingLogger extends MemoryLogger {
    debugCalls: Array<{ event: string; payload?: unknown }>;
    infoCalls: Array<{ event: string; payload?: unknown }>;
    warnCalls: Array<{ event: string; payload?: unknown }>;
    errorCalls: Array<{ event: string; payload?: unknown }>;
}

function makeRecordingLogger(): RecordingLogger {
    const debugCalls: Array<{ event: string; payload?: unknown }> = [];
    const infoCalls: Array<{ event: string; payload?: unknown }> = [];
    const warnCalls: Array<{ event: string; payload?: unknown }> = [];
    const errorCalls: Array<{ event: string; payload?: unknown }> = [];
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
        stagingStore: new SQLiteMemoryStagingStore({ db, ids, logger }),
        retainedStore: new SQLiteMemoryRetainedStore({ db, logger }),
    };
}

// ============================================================================
// candidate store
// ============================================================================

describe("SQLiteMemoryCandidateStore — appendCandidates", () => {
    it("inserts multiple rows with monotonically increasing seq inside one assistant turn", async () => {
        const { candidateStore } = freshStores();
        const source = makeSource();

        const written = await candidateStore.appendCandidates({
            source,
            candidates: [
                { scope: "user", type: "fact", text: "first" },
                { scope: "user", type: "fact", text: "second" },
                { scope: "user", type: "fact", text: "third" },
            ],
        });

        assert.equal(written.length, 3);
        assert.equal(written[0]!.seq, 0);
        assert.equal(written[1]!.seq, 1);
        assert.equal(written[2]!.seq, 2);
        for (const row of written) {
            assert.equal(row.status, "pending");
            assert.equal(row.source.assistantMessageId, source.assistantMessageId);
        }
    });

    it("continues seq across subsequent appends in the same assistant turn", async () => {
        const { candidateStore } = freshStores();
        const source = makeSource();
        await candidateStore.appendCandidates({
            source,
            candidates: [{ scope: "user", type: "fact", text: "first" }],
        });
        const more = await candidateStore.appendCandidates({
            source,
            candidates: [
                { scope: "user", type: "fact", text: "second" },
                { scope: "user", type: "fact", text: "third" },
            ],
        });
        assert.equal(more[0]!.seq, 1);
        assert.equal(more[1]!.seq, 2);
    });

    it("isolates seq between different (conversation, assistantMessageId) pairs", async () => {
        const { candidateStore } = freshStores();
        await candidateStore.appendCandidates({
            source: makeSource({ assistantMessageId: "amsg-A" }),
            candidates: [{ scope: "user", type: "fact", text: "a" }],
        });
        const second = await candidateStore.appendCandidates({
            source: makeSource({ assistantMessageId: "amsg-B" }),
            candidates: [{ scope: "user", type: "fact", text: "b" }],
        });
        assert.equal(second[0]!.seq, 0);
    });

    it("persists candidateReason in its own column (Batch 3.5 schema)", async () => {
        const { candidateStore, db } = freshStores();
        const [written] = await candidateStore.appendCandidates({
            source: makeSource(),
            candidates: [{
                scope: "user",
                type: "fact",
                text: "User likes ramen.",
                reason: "user_explicit_statement",
            }],
        });
        assert.ok(written);
        assert.equal(written.candidateReason, "user_explicit_statement");

        const row = (await db.select().from(memoryCandidates).where(eq(memoryCandidates.id, written.id)))[0]!;
        assert.equal(row.candidateReason, "user_explicit_statement");
        // status_reason starts as NULL until the processor sets it.
        assert.equal(row.statusReason, null);
    });

    it("round-trips relatedEntities and tags through their JSON columns", async () => {
        const { candidateStore } = freshStores();
        const [written] = await candidateStore.appendCandidates({
            source: makeSource(),
            candidates: [{
                scope: "user",
                type: "fact",
                text: "user mentioned dog Alfa",
                relatedEntities: ["Alfa", "user"],
                tags: ["pet", "name"],
            }],
        });
        assert.deepEqual(written!.relatedEntities, ["Alfa", "user"]);
        assert.deepEqual(written!.tags, ["pet", "name"]);

        const listed = await candidateStore.listCandidates({
            userId: "user-A",
            characterId: "char-A",
            assistantMessageId: "amsg-1",
        });
        assert.equal(listed.length, 1);
        assert.deepEqual(listed[0]!.relatedEntities, ["Alfa", "user"]);
        assert.deepEqual(listed[0]!.tags, ["pet", "name"]);
    });

    it("returns [] for appendCandidates with no candidates", async () => {
        const { candidateStore } = freshStores();
        const out = await candidateStore.appendCandidates({
            source: makeSource(),
            candidates: [],
        });
        assert.deepEqual(out, []);
    });
});

describe("SQLiteMemoryCandidateStore — read paths", () => {
    it("listPendingCandidates filters by (userId, characterId, status='pending') ordered by createdAt then seq", async () => {
        const { candidateStore, clock } = freshStores();

        // Two pending rows in conv-1.
        await candidateStore.appendCandidates({
            source: makeSource({ assistantMessageId: "amsg-1" }),
            candidates: [
                { scope: "user", type: "fact", text: "p1" },
                { scope: "user", type: "fact", text: "p2" },
            ],
        });
        clock.advance(1000);
        // One more pending row in a later turn so createdAt differs.
        await candidateStore.appendCandidates({
            source: makeSource({ assistantMessageId: "amsg-2" }),
            candidates: [{ scope: "user", type: "fact", text: "p3" }],
        });
        // A different character — must be excluded.
        await candidateStore.appendCandidates({
            source: makeSource({ characterId: "char-B", assistantMessageId: "amsg-X" }),
            candidates: [{ scope: "user", type: "fact", text: "other-char" }],
        });
        // A different user — must be excluded.
        await candidateStore.appendCandidates({
            source: makeSource({ userId: "user-B", assistantMessageId: "amsg-Y" }),
            candidates: [{ scope: "user", type: "fact", text: "other-user" }],
        });

        const pending = await candidateStore.listPendingCandidates({
            userId: "user-A",
            characterId: "char-A",
            limit: 50,
        });
        assert.equal(pending.length, 3);
        assert.deepEqual(pending.map((r) => r.text), ["p1", "p2", "p3"]);
    });

    it("listPendingCandidates respects the requested limit", async () => {
        const { candidateStore } = freshStores();
        await candidateStore.appendCandidates({
            source: makeSource(),
            candidates: [
                { scope: "user", type: "fact", text: "p1" },
                { scope: "user", type: "fact", text: "p2" },
                { scope: "user", type: "fact", text: "p3" },
            ],
        });
        const limited = await candidateStore.listPendingCandidates({
            userId: "user-A",
            characterId: "char-A",
            limit: 2,
        });
        assert.equal(limited.length, 2);
    });

    it("excludes rows whose status was advanced away from pending", async () => {
        const { candidateStore, clock } = freshStores();
        const written = await candidateStore.appendCandidates({
            source: makeSource(),
            candidates: [
                { scope: "user", type: "fact", text: "stays pending" },
                { scope: "user", type: "fact", text: "gets processed" },
            ],
        });
        clock.advance(500);
        await candidateStore.updateCandidateStatus({
            candidateId: written[1]!.id,
            status: "processed",
            statusReason: "staging_created",
            updatedAt: clock.nowIso(),
        });

        const pending = await candidateStore.listPendingCandidates({
            userId: "user-A",
            characterId: "char-A",
            limit: 10,
        });
        assert.equal(pending.length, 1);
        assert.equal(pending[0]!.text, "stays pending");
    });
});

describe("SQLiteMemoryCandidateStore — updateCandidateStatus", () => {
    it("persists statusReason and updatedAt", async () => {
        const { candidateStore, db, clock } = freshStores();
        const [written] = await candidateStore.appendCandidates({
            source: makeSource(),
            candidates: [{ scope: "user", type: "fact", text: "x" }],
        });
        assert.ok(written);
        clock.advance(1000);
        const updatedAt = clock.nowIso();
        await candidateStore.updateCandidateStatus({
            candidateId: written.id,
            status: "rejected_by_rule",
            statusReason: "too_short",
            updatedAt,
        });
        const row = (await db.select().from(memoryCandidates).where(eq(memoryCandidates.id, written.id)))[0]!;
        assert.equal(row.status, "rejected_by_rule");
        assert.equal(row.statusReason, "too_short");
        assert.equal(row.updatedAt, updatedAt);
    });

    it("leaves statusReason untouched when not provided", async () => {
        const { candidateStore, db, clock } = freshStores();
        const [written] = await candidateStore.appendCandidates({
            source: makeSource(),
            candidates: [{ scope: "user", type: "fact", text: "x" }],
        });
        assert.ok(written);
        await candidateStore.updateCandidateStatus({
            candidateId: written.id,
            status: "processed",
            statusReason: "first_reason",
            updatedAt: clock.nowIso(),
        });
        clock.advance(1000);
        await candidateStore.updateCandidateStatus({
            candidateId: written.id,
            status: "processed",
            updatedAt: clock.nowIso(),
        });
        const row = (await db.select().from(memoryCandidates).where(eq(memoryCandidates.id, written.id)))[0]!;
        assert.equal(row.statusReason, "first_reason");
    });
});

// ============================================================================
// staging store
// ============================================================================

describe("SQLiteMemoryStagingStore — create + findExact + findBySourceCandidate", () => {
    it("transactionally creates the staging row and its first source link", async () => {
        const { stagingStore, db, clock } = freshStores();
        const created = await stagingStore.create({
            userId: "user-A",
            characterId: "char-A",
            scope: "user",
            type: "fact",
            text: "User likes ramen",
            normalizedText: "user likes ramen",
            relatedEntities: ["ramen"],
            tags: ["food"],
            status: "pending",
            statusReason: "created_from_candidate",
            firstSeenAt: "2026-02-01T00:00:00.000Z",
            now: clock.nowIso(),
            embedding: makeEmbedding([0.1, 0.2, 0.3]),
            initialSource: {
                candidateId: "cand-1",
                candidateSeq: 0,
            },
        });

        assert.equal(created.occurrenceCount, 1);
        assert.equal(created.embedding?.vector.length, 3);

        const stagingRows = await db.select().from(memoryStaging).where(eq(memoryStaging.id, created.id));
        assert.equal(stagingRows.length, 1);
        const sourceRows = await db
            .select()
            .from(memoryStagingSources)
            .where(eq(memoryStagingSources.memoryStagingId, created.id));
        assert.equal(sourceRows.length, 1);
        assert.equal(sourceRows[0]!.candidateId, "cand-1");
    });

    it("findExact matches on (userId, characterId, scope, type, normalizedText) only", async () => {
        const { stagingStore, clock } = freshStores();
        await stagingStore.create({
            userId: "user-A",
            characterId: "char-A",
            scope: "user",
            type: "fact",
            text: "User likes ramen",
            normalizedText: "user likes ramen",
            relatedEntities: [],
            tags: [],
            status: "pending",
            firstSeenAt: clock.nowIso(),
            now: clock.nowIso(),
            initialSource: { candidateId: "cand-1", candidateSeq: 0 },
        });
        const hit = await stagingStore.findExact({
            userId: "user-A",
            characterId: "char-A",
            scope: "user",
            type: "fact",
            normalizedText: "user likes ramen",
        });
        assert.ok(hit);

        // Different normalized text → miss.
        assert.equal(
            await stagingStore.findExact({
                userId: "user-A",
                characterId: "char-A",
                scope: "user",
                type: "fact",
                normalizedText: "user likes pizza",
            }),
            undefined,
        );

        // Different character → miss (no cross-character matching).
        assert.equal(
            await stagingStore.findExact({
                userId: "user-A",
                characterId: "char-B",
                scope: "user",
                type: "fact",
                normalizedText: "user likes ramen",
            }),
            undefined,
        );
    });

    it("findBySourceCandidate returns the staging row a candidate is linked to", async () => {
        const { stagingStore, clock } = freshStores();
        const created = await stagingStore.create({
            userId: "user-A",
            characterId: "char-A",
            scope: "user",
            type: "fact",
            text: "x",
            normalizedText: "x",
            relatedEntities: [],
            tags: [],
            status: "pending",
            firstSeenAt: clock.nowIso(),
            now: clock.nowIso(),
            initialSource: { candidateId: "cand-1", candidateSeq: 0 },
        });
        const got = await stagingStore.findBySourceCandidate({ candidateId: "cand-1" });
        assert.ok(got);
        assert.equal(got.id, created.id);

        assert.equal(
            await stagingStore.findBySourceCandidate({ candidateId: "cand-unknown" }),
            undefined,
        );
    });

    it("warns and returns undefined when a candidate link points at a missing staging row", async () => {
        const { stagingStore, db, logger } = freshStores();
        // Insert a dangling link manually.
        await db.insert(memoryStagingSources).values({
            memoryStagingId: "missing-staging",
            candidateId: "orphan-cand",
            candidateSeq: 0,
            createdAt: "2026-02-01T00:00:00.000Z",
        });
        const got = await stagingStore.findBySourceCandidate({ candidateId: "orphan-cand" });
        assert.equal(got, undefined);
        assert.equal(
            logger.warnCalls.some((c) => c.event === "memory.sqlite.staging_link_orphan"),
            true,
        );
    });
});

describe("SQLiteMemoryStagingStore — linkSource + incrementOccurrence", () => {
    it("linkSource enforces UNIQUE on candidate_id so retries cannot double-link", async () => {
        const { stagingStore, clock } = freshStores();
        const created = await stagingStore.create({
            userId: "user-A",
            characterId: "char-A",
            scope: "user",
            type: "fact",
            text: "x",
            normalizedText: "x",
            relatedEntities: [],
            tags: [],
            status: "pending",
            firstSeenAt: clock.nowIso(),
            now: clock.nowIso(),
            initialSource: { candidateId: "cand-1", candidateSeq: 0 },
        });
        // Re-linking the same candidate must throw (the UNIQUE
        // constraint is what makes processor retries idempotent).
        await assert.rejects(
            stagingStore.linkSource({
                memoryStagingId: created.id,
                candidateId: "cand-1",
                candidateSeq: 0,
                createdAt: clock.nowIso(),
            }),
            /UNIQUE|constraint/i,
        );
    });

    it("incrementOccurrence atomically bumps occurrenceCount and refreshes lastSeenAt/updatedAt", async () => {
        const { stagingStore, clock } = freshStores();
        const created = await stagingStore.create({
            userId: "user-A",
            characterId: "char-A",
            scope: "user",
            type: "fact",
            text: "x",
            normalizedText: "x",
            relatedEntities: [],
            tags: [],
            status: "pending",
            firstSeenAt: "2026-02-01T00:00:00.000Z",
            now: "2026-02-01T00:00:00.000Z",
            initialSource: { candidateId: "cand-1", candidateSeq: 0 },
        });
        assert.equal(created.occurrenceCount, 1);

        clock.advance(60_000);
        const newNow = clock.nowIso();
        // Link a fresh candidate first (mirrors the processor flow).
        await stagingStore.linkSource({
            memoryStagingId: created.id,
            candidateId: "cand-2",
            candidateSeq: 1,
            createdAt: newNow,
        });
        const incremented = await stagingStore.incrementOccurrence({
            memoryStagingId: created.id,
            lastSeenAt: newNow,
            updatedAt: newNow,
        });
        assert.equal(incremented.occurrenceCount, 2);
        assert.equal(incremented.lastSeenAt, newNow);
        assert.equal(incremented.updatedAt, newNow);

        // First-seen timestamp is sticky.
        assert.equal(incremented.firstSeenAt, "2026-02-01T00:00:00.000Z");
    });

    it("incrementOccurrence is additive across many invocations", async () => {
        const { stagingStore, clock } = freshStores();
        const created = await stagingStore.create({
            userId: "user-A",
            characterId: "char-A",
            scope: "user",
            type: "fact",
            text: "x",
            normalizedText: "x",
            relatedEntities: [],
            tags: [],
            status: "pending",
            firstSeenAt: clock.nowIso(),
            now: clock.nowIso(),
            initialSource: { candidateId: "cand-1", candidateSeq: 0 },
        });
        for (let i = 0; i < 4; i += 1) {
            const tick = clock.nowIso();
            clock.advance(1);
            await stagingStore.linkSource({
                memoryStagingId: created.id,
                candidateId: `cand-extra-${i}`,
                candidateSeq: i + 1,
                createdAt: tick,
            });
            await stagingStore.incrementOccurrence({
                memoryStagingId: created.id,
                lastSeenAt: tick,
                updatedAt: tick,
            });
        }
        const [row] = await stagingStore.list({
            userId: "user-A",
            characterId: "char-A",
            scope: "user",
            type: "fact",
            status: "pending",
            limit: 10,
        });
        assert.equal(row!.occurrenceCount, 5);
    });
});

describe("SQLiteMemoryStagingStore — list", () => {
    it("returns rows for the requested (userId, characterId, scope, type, status) bucket", async () => {
        const { stagingStore, clock } = freshStores();
        await stagingStore.create({
            userId: "user-A",
            characterId: "char-A",
            scope: "user",
            type: "fact",
            text: "in-bucket",
            normalizedText: "in-bucket",
            relatedEntities: [],
            tags: [],
            status: "pending",
            firstSeenAt: clock.nowIso(),
            now: clock.nowIso(),
            initialSource: { candidateId: "cand-A", candidateSeq: 0 },
        });
        await stagingStore.create({
            userId: "user-A",
            characterId: "char-B", // different character
            scope: "user",
            type: "fact",
            text: "other-char",
            normalizedText: "other-char",
            relatedEntities: [],
            tags: [],
            status: "pending",
            firstSeenAt: clock.nowIso(),
            now: clock.nowIso(),
            initialSource: { candidateId: "cand-B", candidateSeq: 0 },
        });

        const rows = await stagingStore.list({
            userId: "user-A",
            characterId: "char-A",
            scope: "user",
            type: "fact",
            status: "pending",
            limit: 50,
        });
        assert.equal(rows.length, 1);
        assert.equal(rows[0]!.text, "in-bucket");
    });

    it("sourceCandidateId filters to just the staging row a candidate is linked to", async () => {
        const { stagingStore, clock } = freshStores();
        const staging = await stagingStore.create({
            userId: "user-A",
            characterId: "char-A",
            scope: "user",
            type: "fact",
            text: "ramen",
            normalizedText: "ramen",
            relatedEntities: [],
            tags: [],
            status: "pending",
            firstSeenAt: clock.nowIso(),
            now: clock.nowIso(),
            initialSource: { candidateId: "cand-1", candidateSeq: 0 },
        });

        const linked = await stagingStore.list({
            userId: "user-A",
            sourceCandidateId: "cand-1",
        });
        assert.equal(linked.length, 1);
        assert.equal(linked[0]!.id, staging.id);

        const notLinked = await stagingStore.list({
            userId: "user-A",
            sourceCandidateId: "cand-nope",
        });
        assert.equal(notLinked.length, 0);
    });
});

// ============================================================================
// retained store (read-only in Batch 3.5)
// ============================================================================

describe("SQLiteMemoryRetainedStore", () => {
    it("returns [] from an empty table without error", async () => {
        const { retainedStore } = freshStores();
        const rows = await retainedStore.list({ userId: "user-A", characterId: "char-A" });
        assert.deepEqual(rows, []);
    });

    it("create round-trips a retained memory with occurrence accounting", async () => {
        const { retainedStore } = freshStores();
        const created = await retainedStore.create({
            id: "ret-1",
            userId: "user-A",
            characterId: "char-A",
            scope: "user",
            type: "fact",
            text: "User lives in Tokyo.",
            normalizedText: "user lives in tokyo",
            relatedEntities: ["Tokyo"],
            tags: ["location"],
            sourceStagingId: "staging-1",
            status: "active",
            importance: 4,
            occurrenceCount: 2,
            firstSeenAt: "2026-01-01T00:00:00.000Z",
            lastSeenAt: "2026-02-01T00:00:00.000Z",
            embedding: makeEmbedding([0.1, 0.2, 0.3, 0.4]),
            now: "2026-02-01T00:00:00.000Z",
        });
        assert.equal(created.occurrenceCount, 2);
        assert.equal(created.sourceStagingId, "staging-1");

        const [row] = await retainedStore.list({ userId: "user-A", characterId: "char-A" });
        assert.equal(row!.text, "User lives in Tokyo.");
        assert.deepEqual(row!.relatedEntities, ["Tokyo"]);
        assert.equal(row!.importance, 4);
        assert.equal(row!.occurrenceCount, 2);
        assert.equal(row!.firstSeenAt, "2026-01-01T00:00:00.000Z");
        assert.deepEqual(row!.embedding!.vector, [0.1, 0.2, 0.3, 0.4]);
    });

    it("update accumulates occurrence and overwrites provided fields only", async () => {
        const { retainedStore } = freshStores();
        await retainedStore.create({
            id: "ret-1", userId: "user-A", characterId: "char-A", scope: "user", type: "fact",
            text: "User lives in Japan.", normalizedText: "user lives in japan",
            relatedEntities: [], tags: [], status: "active", importance: 3,
            occurrenceCount: 1, firstSeenAt: "2026-01-01T00:00:00.000Z", lastSeenAt: "2026-01-01T00:00:00.000Z",
            embedding: makeEmbedding([1, 0, 0, 0]), now: "2026-01-01T00:00:00.000Z",
        });
        const updated = await retainedStore.update({
            memoryRetainedId: "ret-1",
            text: "User lives in Tokyo, Japan.",
            normalizedText: "user lives in tokyo, japan",
            importance: 5,
            occurrenceDelta: 2,
            lastSeenAt: "2026-03-01T00:00:00.000Z",
            embedding: makeEmbedding([0, 1, 0, 0]),
            updatedAt: "2026-03-01T00:00:00.000Z",
        });
        assert.equal(updated.text, "User lives in Tokyo, Japan.");
        assert.equal(updated.importance, 5);
        assert.equal(updated.occurrenceCount, 3);
        assert.equal(updated.lastSeenAt, "2026-03-01T00:00:00.000Z");
        assert.deepEqual(updated.embedding!.vector, [0, 1, 0, 0]);
    });

    it("archive flips status to archived", async () => {
        const { retainedStore } = freshStores();
        await retainedStore.create({
            id: "ret-1", userId: "user-A", characterId: "char-A", scope: "user", type: "fact",
            text: "x", normalizedText: "x", relatedEntities: [], tags: [], status: "active",
            importance: 3, occurrenceCount: 1, firstSeenAt: "2026-01-01T00:00:00.000Z",
            lastSeenAt: "2026-01-01T00:00:00.000Z", now: "2026-01-01T00:00:00.000Z",
        });
        await retainedStore.archive({ memoryRetainedId: "ret-1", statusReason: "stale", updatedAt: "2026-04-01T00:00:00.000Z" });
        const active = await retainedStore.list({ userId: "user-A", characterId: "char-A", status: "active" });
        assert.equal(active.length, 0);
        const archived = await retainedStore.list({ userId: "user-A", characterId: "char-A", status: "archived" });
        assert.equal(archived.length, 1);
    });
});

// ============================================================================
// consolidation decision store (Batch 4)
// ============================================================================

describe("SQLiteMemoryConsolidationDecisionStore", () => {
    function makeDecisionInput(overrides: Record<string, unknown> = {}) {
        return {
            id: "dec-1",
            userId: "user-A",
            characterId: "char-A",
            memoryStagingId: "staging-1",
            action: "create" as const,
            archivedRetainedMemoryIds: [],
            judgeRequest: { messages: ["x"] },
            judgeResponse: { action: "create" },
            validatedAction: { action: "create", archiveRetainedMemoryIds: [] },
            status: "applied" as const,
            modelCallPurpose: "memory.consolidate",
            model: "fake-model",
            requestId: "req-1",
            createdAt: "2026-02-01T00:00:00.000Z",
            ...overrides,
        };
    }

    it("create round-trips a decision and parses JSON columns", async () => {
        const { db, logger } = freshStores();
        const store = new SQLiteMemoryConsolidationDecisionStore({ db, logger });
        const created = await store.create(makeDecisionInput({
            createdRetainedMemoryId: "ret-1",
            archivedRetainedMemoryIds: ["a", "b"],
        }));
        assert.equal(created.action, "create");
        assert.equal(created.createdRetainedMemoryId, "ret-1");
        assert.deepEqual(created.archivedRetainedMemoryIds, ["a", "b"]);
        assert.deepEqual(created.judgeRequest, { messages: ["x"] });
        assert.deepEqual(created.validatedAction, { action: "create", archiveRetainedMemoryIds: [] });
    });

    it("findApplied returns the applied decision and ignores rejected ones", async () => {
        const { db, logger } = freshStores();
        const store = new SQLiteMemoryConsolidationDecisionStore({ db, logger });
        await store.create(makeDecisionInput({ id: "dec-rej", memoryStagingId: "staging-9", status: "rejected" }));
        const none = await store.findApplied({ memoryStagingId: "staging-9" });
        assert.equal(none, undefined);

        await store.create(makeDecisionInput({ id: "dec-ok", memoryStagingId: "staging-9", status: "applied" }));
        const found = await store.findApplied({ memoryStagingId: "staging-9" });
        assert.equal(found!.id, "dec-ok");
    });

    it("enforces at most one applied decision per staging row", async () => {
        const { db, logger } = freshStores();
        const store = new SQLiteMemoryConsolidationDecisionStore({ db, logger });
        await store.create(makeDecisionInput({ id: "dec-1", status: "applied" }));
        await assert.rejects(
            store.create(makeDecisionInput({ id: "dec-2", status: "applied" })),
        );
    });

    it("list filters by action and status", async () => {
        const { db, logger } = freshStores();
        const store = new SQLiteMemoryConsolidationDecisionStore({ db, logger });
        await store.create(makeDecisionInput({ id: "d1", memoryStagingId: "s1", action: "create", status: "applied" }));
        await store.create(makeDecisionInput({ id: "d2", memoryStagingId: "s2", action: "ignore", status: "applied" }));
        const onlyCreate = await store.list({ userId: "user-A", action: "create" });
        assert.equal(onlyCreate.length, 1);
        assert.equal(onlyCreate[0]!.id, "d1");
    });
});

// ============================================================================
// createSqliteStores wiring
// ============================================================================

describe("createSqliteStores", () => {
    it("wires the three memory stores onto AppStores", () => {
        const { db } = openDatabase(":memory:");
        const clock = makeClock();
        const ids = makeIds();
        const logger = makeRecordingLogger();
        const stores = createSqliteStores({ db, memoryClock: clock, memoryIds: ids, memoryLogger: logger });
        assert.ok(stores.memoryCandidate);
        assert.ok(stores.memoryStaging);
        assert.ok(stores.memoryRetained);
        assert.ok(stores.memoryConsolidationDecision);
    });
});
