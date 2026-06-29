import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import type {
    ListMemoryCandidatesResponse,
    ListMemoryRetainedResponse,
    ListMemoryStagingResponse,
    MemoryCandidateInfo,
    MemoryCandidateType,
    MemoryRetainedInfo,
    MemoryScope,
    MemoryStagingInfo,
} from "@ss-ai/contracts";
import { createTestApp, type TestApp } from "./helpers/testServer.js";
import {
    StubMemoryCandidateStore,
    StubMemoryRetainedStore,
    StubMemoryStagingStore,
} from "./helpers/inMemoryMemoryStores.js";

/**
 * Memory debug API tests (Batch 3.5 surface).
 *
 * The surface is:
 *  - GET /v1/debug/memory-candidates  — list raw candidate rows
 *  - GET /v1/debug/memory-staging     — list staging (aggregated) rows
 *  - GET /v1/debug/memory-retained    — list retained (consolidated) rows; required `characterId`
 *
 * In the default `default-user` auth mode every request is
 * implicitly the user `"default"`. We seed rows for both `"default"`
 * and a second user `"other"` directly through the store handles
 * exposed on `app.stores`, then assert the HTTP routes only ever
 * surface the `"default"` rows back. That double-seed pattern is
 * what proves cross-user isolation without standing up a real
 * session.
 */

const NOW = "2026-06-27T00:00:00.000Z";

// ── seed helpers ─────────────────────────────────────────────────────────────

interface SeedCandidateOptions {
    userId?: string;
    characterId?: string;
    conversationId?: string;
    assistantMessageId?: string;
    text?: string;
    scope?: MemoryScope;
    type?: MemoryCandidateType;
}

async function seedCandidate(store: StubMemoryCandidateStore, opts: SeedCandidateOptions = {}): Promise<void> {
    await store.appendCandidates({
        source: {
            userId: opts.userId ?? "default",
            characterId: opts.characterId ?? "char-A",
            conversationId: opts.conversationId ?? "conv-1",
            userMessageId: "u-msg-1",
            assistantMessageId: opts.assistantMessageId ?? "a-msg-1",
            requestId: "req-1",
            modelCallPurpose: "chat.main",
        },
        candidates: [
            {
                scope: opts.scope ?? "user",
                type: opts.type ?? "fact",
                text: opts.text ?? "User said hi",
            },
        ],
    });
}

interface SeedStagingOptions {
    userId?: string;
    characterId?: string;
    scope?: MemoryScope;
    type?: MemoryCandidateType;
    text?: string;
    candidateId?: string;
}

async function seedStaging(store: StubMemoryStagingStore, opts: SeedStagingOptions = {}): Promise<MemoryStagingInfo["id"]> {
    const text = opts.text ?? "staged evidence";
    const record = await store.create({
        userId: opts.userId ?? "default",
        characterId: opts.characterId ?? "char-A",
        scope: opts.scope ?? "user",
        type: opts.type ?? "fact",
        text,
        normalizedText: text.toLowerCase(),
        relatedEntities: [],
        tags: [],
        status: "pending",
        firstSeenAt: NOW,
        now: NOW,
        initialSource: { candidateId: opts.candidateId ?? `cand-${Math.random().toString(36).slice(2)}`, candidateSeq: 0 },
    });
    return record.id;
}

interface SeedRetainedOptions {
    userId?: string;
    characterId?: string;
    scope?: MemoryScope;
    type?: MemoryCandidateType;
    text?: string;
    status?: "active" | "archived";
}

function seedRetained(store: StubMemoryRetainedStore, opts: SeedRetainedOptions = {}): void {
    const text = opts.text ?? "a memory";
    store.rows.push({
        id: `ret-${store.rows.length + 1}`,
        userId: opts.userId ?? "default",
        characterId: opts.characterId ?? "char-A",
        scope: opts.scope ?? "user",
        type: opts.type ?? "fact",
        text,
        normalizedText: text.toLowerCase(),
        relatedEntities: [],
        tags: [],
        status: opts.status ?? "active",
        importance: 0.5,
        schemaVersion: 1,
        createdAt: NOW,
        updatedAt: NOW,
    });
}

// ============================================================================
// /v1/debug/memory-candidates
// ============================================================================

describe("Memory Debug API — /v1/debug/memory-candidates", () => {
    let app: TestApp;
    let candidateStore: StubMemoryCandidateStore;

    beforeEach(() => {
        app = createTestApp();
        candidateStore = app.stores.memoryCandidate as StubMemoryCandidateStore;
    });
    afterEach(() => app.cleanup());

    it("returns only the current user's candidates", async () => {
        await seedCandidate(candidateStore, { userId: "default", text: "mine" });
        await seedCandidate(candidateStore, { userId: "other", text: "theirs" });

        const res = await app.agent.get("/v1/debug/memory-candidates").expect(200);
        const body = res.body as ListMemoryCandidatesResponse;
        assert.equal(body.candidates.length, 1);
        assert.equal(body.candidates[0]!.userId, "default");
        assert.equal(body.candidates[0]!.text, "mine");
    });

    it("filters by characterId / conversationId / assistantMessageId / status", async () => {
        await seedCandidate(candidateStore, { characterId: "char-A", conversationId: "conv-1", assistantMessageId: "a-1", text: "A1" });
        await seedCandidate(candidateStore, { characterId: "char-B", conversationId: "conv-2", assistantMessageId: "a-2", text: "B2" });

        const byChar = await app.agent.get("/v1/debug/memory-candidates?characterId=char-A").expect(200);
        assert.deepEqual(
            (byChar.body as ListMemoryCandidatesResponse).candidates.map((c) => c.text),
            ["A1"],
        );

        const byConv = await app.agent.get("/v1/debug/memory-candidates?conversationId=conv-2").expect(200);
        assert.deepEqual(
            (byConv.body as ListMemoryCandidatesResponse).candidates.map((c) => c.text),
            ["B2"],
        );

        const byMsg = await app.agent.get("/v1/debug/memory-candidates?assistantMessageId=a-1").expect(200);
        assert.deepEqual(
            (byMsg.body as ListMemoryCandidatesResponse).candidates.map((c) => c.text),
            ["A1"],
        );

        const byStatusSingle = await app.agent.get("/v1/debug/memory-candidates?status=pending").expect(200);
        assert.equal((byStatusSingle.body as ListMemoryCandidatesResponse).candidates.length, 2);
        const byStatusList = await app.agent.get("/v1/debug/memory-candidates?status=pending,processed").expect(200);
        assert.equal((byStatusList.body as ListMemoryCandidatesResponse).candidates.length, 2);
        const byStatusUnknown = await app.agent.get("/v1/debug/memory-candidates?status=processed").expect(200);
        assert.equal((byStatusUnknown.body as ListMemoryCandidatesResponse).candidates.length, 0);
    });

    it("returns 400 on invalid candidate status enum tokens", async () => {
        const bad = await app.agent.get("/v1/debug/memory-candidates?status=committed").expect(400);
        assert.equal(bad.body.code, "memory.debug.invalid_enum_value");
        assert.deepEqual(bad.body.params, { param: "status", value: "committed" });
    });

    it("clamps limit to the [1, 500] window with default 100", async () => {
        for (let i = 0; i < 3; i += 1) {
            await seedCandidate(candidateStore, { text: `t${i}`, assistantMessageId: `a-${i}` });
        }

        const explicit = await app.agent.get("/v1/debug/memory-candidates?limit=2").expect(200);
        assert.equal((explicit.body as ListMemoryCandidatesResponse).candidates.length, 2);

        const fallback = await app.agent.get("/v1/debug/memory-candidates?limit=notanumber").expect(200);
        assert.equal((fallback.body as ListMemoryCandidatesResponse).candidates.length, 3);

        const negative = await app.agent.get("/v1/debug/memory-candidates?limit=-5").expect(200);
        assert.equal((negative.body as ListMemoryCandidatesResponse).candidates.length, 3);

        const aboveMax = await app.agent.get("/v1/debug/memory-candidates?limit=9999").expect(200);
        assert.equal((aboveMax.body as ListMemoryCandidatesResponse).candidates.length, 3);
    });

    it("projects candidate fields with candidateReason / statusReason split (Batch 3.5)", async () => {
        await seedCandidate(candidateStore, { text: "with no embedding" });
        const res = await app.agent.get("/v1/debug/memory-candidates").expect(200);
        const info: MemoryCandidateInfo = (res.body as ListMemoryCandidatesResponse).candidates[0]!;
        assert.equal(info.userId, "default");
        assert.equal(info.characterId, "char-A");
        assert.equal(info.conversationId, "conv-1");
        assert.equal(info.modelCallPurpose, "chat.main");
        assert.equal(info.text, "with no embedding");
        assert.equal(info.status, "pending");
        assert.equal(info.candidateReason, null);
        assert.equal(info.statusReason, null);
        // normalizedText/embedding now live on staging — never on the candidate projection.
        assert.equal((info as unknown as Record<string, unknown>).normalizedText, undefined);
        assert.equal((info as unknown as Record<string, unknown>).embedding, undefined);
    });
});

// ============================================================================
// /v1/debug/memory-staging
// ============================================================================

describe("Memory Debug API — /v1/debug/memory-staging", () => {
    let app: TestApp;
    let stagingStore: StubMemoryStagingStore;

    beforeEach(() => {
        app = createTestApp();
        stagingStore = app.stores.memoryStaging as StubMemoryStagingStore;
    });
    afterEach(() => app.cleanup());

    it("returns only the current user's staging rows", async () => {
        await seedStaging(stagingStore, { userId: "default", text: "mine", candidateId: "c-1" });
        await seedStaging(stagingStore, { userId: "other", text: "theirs", candidateId: "c-2" });

        const res = await app.agent.get("/v1/debug/memory-staging").expect(200);
        const body = res.body as ListMemoryStagingResponse;
        assert.equal(body.staging.length, 1);
        assert.equal(body.staging[0]!.userId, "default");
    });

    it("filters by characterId / scope / type / status / sourceCandidateId", async () => {
        await seedStaging(stagingStore, { characterId: "char-A", scope: "user", type: "fact", text: "A-fact", candidateId: "c-A" });
        await seedStaging(stagingStore, { characterId: "char-B", scope: "user", type: "fact", text: "B-fact", candidateId: "c-B" });
        await seedStaging(stagingStore, { characterId: "char-A", scope: "world", type: "event", text: "world-event", candidateId: "c-W" });

        const byChar = await app.agent.get("/v1/debug/memory-staging?characterId=char-A").expect(200);
        assert.equal((byChar.body as ListMemoryStagingResponse).staging.length, 2);
        for (const row of (byChar.body as ListMemoryStagingResponse).staging) {
            assert.equal(row.characterId, "char-A");
        }

        const byScope = await app.agent.get("/v1/debug/memory-staging?scope=world").expect(200);
        assert.deepEqual(
            (byScope.body as ListMemoryStagingResponse).staging.map((r) => r.text),
            ["world-event"],
        );

        const byType = await app.agent.get("/v1/debug/memory-staging?type=event").expect(200);
        assert.deepEqual(
            (byType.body as ListMemoryStagingResponse).staging.map((r) => r.text),
            ["world-event"],
        );

        const bySource = await app.agent.get("/v1/debug/memory-staging?sourceCandidateId=c-A").expect(200);
        assert.deepEqual(
            (bySource.body as ListMemoryStagingResponse).staging.map((r) => r.text),
            ["A-fact"],
        );

        const byStatus = await app.agent.get("/v1/debug/memory-staging?status=pending").expect(200);
        assert.equal((byStatus.body as ListMemoryStagingResponse).staging.length, 3);
    });

    it("returns 400 on an invalid staging status token", async () => {
        const res = await app.agent.get("/v1/debug/memory-staging?status=committed").expect(400);
        assert.equal(res.body.code, "memory.debug.invalid_enum_value");
        assert.deepEqual(res.body.params, { param: "status", value: "committed" });
    });

    it("projects staging fields without raw embedding vector", async () => {
        await seedStaging(stagingStore, { text: "staged fact" });
        const res = await app.agent.get("/v1/debug/memory-staging").expect(200);
        const row: MemoryStagingInfo = (res.body as ListMemoryStagingResponse).staging[0]!;
        assert.equal(row.text, "staged fact");
        assert.equal(row.occurrenceCount, 1);
        assert.equal(row.firstSeenAt, NOW);
        assert.equal(row.lastSeenAt, NOW);
        assert.equal(row.embedding, null);
        assert.ok(!("vector" in (row as unknown as Record<string, unknown>)));
    });
});

// ============================================================================
// /v1/debug/memory-retained
// ============================================================================

describe("Memory Debug API — /v1/debug/memory-retained", () => {
    let app: TestApp;
    let retainedStore: StubMemoryRetainedStore;

    beforeEach(() => {
        app = createTestApp();
        retainedStore = app.stores.memoryRetained as StubMemoryRetainedStore;
    });
    afterEach(() => app.cleanup());

    it("requires characterId and returns 400 otherwise", async () => {
        const res = await app.agent.get("/v1/debug/memory-retained").expect(400);
        assert.equal(res.body.code, "memory.debug.characterId_required");
    });

    it("returns only memories for the requested character and user", async () => {
        seedRetained(retainedStore, { userId: "default", characterId: "char-A", text: "A-self" });
        seedRetained(retainedStore, { userId: "default", characterId: "char-B", text: "B-self" });
        seedRetained(retainedStore, { userId: "other", characterId: "char-A", text: "A-other" });

        const res = await app.agent.get("/v1/debug/memory-retained?characterId=char-A").expect(200);
        const body = res.body as ListMemoryRetainedResponse;
        assert.equal(body.retained.length, 1);
        const row: MemoryRetainedInfo = body.retained[0]!;
        assert.equal(row.userId, "default");
        assert.equal(row.characterId, "char-A");
        assert.equal(row.text, "A-self");
        assert.equal(row.embedding, null);
    });

    it("filters by scope / type / status inside one character world", async () => {
        seedRetained(retainedStore, { scope: "user", type: "fact", text: "u-fact" });
        seedRetained(retainedStore, { scope: "user", type: "preference", text: "u-pref" });
        seedRetained(retainedStore, { scope: "world", type: "fact", text: "w-fact" });
        seedRetained(retainedStore, { scope: "user", type: "fact", text: "u-archived", status: "archived" });

        const byScope = await app.agent.get("/v1/debug/memory-retained?characterId=char-A&scope=user").expect(200);
        assert.deepEqual(
            (byScope.body as ListMemoryRetainedResponse).retained.map((m) => m.text).sort(),
            ["u-fact", "u-pref"].sort(),
        );

        const byType = await app.agent.get("/v1/debug/memory-retained?characterId=char-A&type=fact").expect(200);
        assert.deepEqual(
            (byType.body as ListMemoryRetainedResponse).retained.map((m) => m.text).sort(),
            ["u-fact", "w-fact"].sort(),
        );

        // Default status filter is `active`, applied at the route layer.
        const defaultStatus = await app.agent.get("/v1/debug/memory-retained?characterId=char-A").expect(200);
        assert.equal((defaultStatus.body as ListMemoryRetainedResponse).retained.length, 3);

        const archived = await app.agent.get("/v1/debug/memory-retained?characterId=char-A&status=archived").expect(200);
        assert.deepEqual(
            (archived.body as ListMemoryRetainedResponse).retained.map((m) => m.text),
            ["u-archived"],
        );
    });

    it("returns 400 on invalid status / scope / type enum tokens", async () => {
        const badStatus = await app.agent.get("/v1/debug/memory-retained?characterId=char-A&status=archivd").expect(400);
        assert.equal(badStatus.body.code, "memory.debug.invalid_enum_value");
        assert.deepEqual(badStatus.body.params, { param: "status", value: "archivd" });

        const badScope = await app.agent.get("/v1/debug/memory-retained?characterId=char-A&scope=usr").expect(400);
        assert.equal(badScope.body.code, "memory.debug.invalid_enum_value");
        assert.deepEqual(badScope.body.params, { param: "scope", value: "usr" });
    });
});

// ============================================================================
// auth
// ============================================================================

describe("Memory Debug API — auth", () => {
    it("returns 401 when the request is not authenticated (local-password mode)", async () => {
        const app = createTestApp({}, {
            auth: {
                mode: "local-password",
                defaultUserId: "default",
                allowRegistration: true,
                sessionDays: 30,
                cookieName: "ss_ai_session",
                cookieSecure: false,
            },
        });
        try {
            await app.agent.get("/v1/debug/memory-candidates").expect(401);
            await app.agent.get("/v1/debug/memory-staging").expect(401);
            await app.agent.get("/v1/debug/memory-retained?characterId=char-A").expect(401);
        } finally {
            app.cleanup();
        }
    });
});
