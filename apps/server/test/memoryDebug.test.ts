import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import type {
    ActiveMemoryInfo,
    ListMemoriesResponse,
    ListMemoryCandidatesResponse,
    ListMemoryDecisionsResponse,
    MemoryCandidateInfo,
    MemoryCandidateType,
    MemoryDecisionInfo,
    MemoryScope,
} from "@ss-ai/contracts";
import { createTestApp, type TestApp } from "./helpers/testServer.js";
import {
    StubMemoryCandidateStore,
    StubMemoryDecisionStore,
    StubMemoryStore,
} from "./helpers/inMemoryMemoryStores.js";

/**
 * Step 7 debug API tests.
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
        normalizedTexts: [(opts.text ?? "User said hi").toLowerCase()],
    });
}

interface SeedMemoryOptions {
    userId?: string;
    characterId?: string;
    scope?: MemoryScope;
    type?: MemoryCandidateType;
    text?: string;
    status?: "active" | "archived";
}

async function seedMemory(store: StubMemoryStore, opts: SeedMemoryOptions = {}): Promise<void> {
    const text = opts.text ?? "a memory";
    const record = await store.createMemory({
        userId: opts.userId ?? "default",
        characterId: opts.characterId ?? "char-A",
        scope: opts.scope ?? "user",
        type: opts.type ?? "fact",
        text,
        normalizedText: text.toLowerCase(),
        relatedEntities: [],
        tags: [],
        importance: 0.5,
        createdAt: NOW,
        updatedAt: NOW,
    });
    if (opts.status === "archived") {
        // The stub doesn't expose a transition helper; mutate the
        // record in-place because `rows` holds the same reference
        // (createMemory pushes and returns a clone).
        const stored = store.rows.find((r) => r.id === record.id);
        if (stored) stored.status = "archived";
    }
}

interface SeedDecisionOptions {
    userId?: string;
    characterId?: string;
    candidateId?: string;
    decision?: "create" | "ignore_duplicate" | "ignore_low_value" | "needs_judge" | "embedding_failed" | "error";
}

async function seedDecision(store: StubMemoryDecisionStore, opts: SeedDecisionOptions = {}): Promise<void> {
    await store.appendDecision({
        candidateId: opts.candidateId ?? "cand-1",
        userId: opts.userId ?? "default",
        characterId: opts.characterId ?? "char-A",
        decision: opts.decision ?? "create",
        memoryId: "mem-1",
        similarity: [],
        policyVersion: 1,
        createdAt: NOW,
    });
}

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

        // status filter (single + comma-separated list); both seeded
        // rows are still "pending" so the same filter returns both.
        const byStatusSingle = await app.agent.get("/v1/debug/memory-candidates?status=pending").expect(200);
        assert.equal((byStatusSingle.body as ListMemoryCandidatesResponse).candidates.length, 2);
        const byStatusList = await app.agent.get("/v1/debug/memory-candidates?status=pending,committed").expect(200);
        assert.equal((byStatusList.body as ListMemoryCandidatesResponse).candidates.length, 2);
        const byStatusUnknown = await app.agent.get("/v1/debug/memory-candidates?status=committed").expect(200);
        assert.equal((byStatusUnknown.body as ListMemoryCandidatesResponse).candidates.length, 0);
    });

    it("clamps limit to the [1, 500] window with default 100", async () => {
        for (let i = 0; i < 3; i += 1) {
            await seedCandidate(candidateStore, { text: `t${i}`, assistantMessageId: `a-${i}` });
        }

        const explicit = await app.agent.get("/v1/debug/memory-candidates?limit=2").expect(200);
        assert.equal((explicit.body as ListMemoryCandidatesResponse).candidates.length, 2);

        // Non-numeric falls back to default (100), which is bigger than the seed count.
        const fallback = await app.agent.get("/v1/debug/memory-candidates?limit=notanumber").expect(200);
        assert.equal((fallback.body as ListMemoryCandidatesResponse).candidates.length, 3);

        // Negative falls back to default.
        const negative = await app.agent.get("/v1/debug/memory-candidates?limit=-5").expect(200);
        assert.equal((negative.body as ListMemoryCandidatesResponse).candidates.length, 3);

        // Above-max is clamped to MAX_LIMIT (500); we just confirm
        // the route accepts it without errors and returns all rows.
        const aboveMax = await app.agent.get("/v1/debug/memory-candidates?limit=9999").expect(200);
        assert.equal((aboveMax.body as ListMemoryCandidatesResponse).candidates.length, 3);
    });

    it("projects record fields including embedding signature without raw vector", async () => {
        await seedCandidate(candidateStore, { text: "with no embedding" });
        const res = await app.agent.get("/v1/debug/memory-candidates").expect(200);
        const info: MemoryCandidateInfo = (res.body as ListMemoryCandidatesResponse).candidates[0]!;
        assert.equal(info.userId, "default");
        assert.equal(info.characterId, "char-A");
        assert.equal(info.conversationId, "conv-1");
        assert.equal(info.modelCallPurpose, "chat.main");
        assert.equal(info.text, "with no embedding");
        assert.equal(info.status, "pending");
        // No embedding was attached -> null, never an object with a vector.
        assert.equal(info.embedding, null);
        assert.ok(!("vector" in (info as unknown as Record<string, unknown>)));
    });
});

describe("Memory Debug API — /v1/debug/memories", () => {
    let app: TestApp;
    let memoryStore: StubMemoryStore;

    beforeEach(() => {
        app = createTestApp();
        memoryStore = app.stores.memory as StubMemoryStore;
    });
    afterEach(() => app.cleanup());

    it("requires characterId and returns 400 otherwise", async () => {
        const res = await app.agent.get("/v1/debug/memories").expect(400);
        assert.equal(res.body.code, "memory.debug.characterId_required");
    });

    it("returns only memories for the requested character and user", async () => {
        await seedMemory(memoryStore, { userId: "default", characterId: "char-A", text: "A-self" });
        await seedMemory(memoryStore, { userId: "default", characterId: "char-B", text: "B-self" });
        await seedMemory(memoryStore, { userId: "other", characterId: "char-A", text: "A-other" });

        const res = await app.agent.get("/v1/debug/memories?characterId=char-A").expect(200);
        const body = res.body as ListMemoriesResponse;
        assert.equal(body.memories.length, 1);
        const memory: ActiveMemoryInfo = body.memories[0]!;
        assert.equal(memory.userId, "default");
        assert.equal(memory.characterId, "char-A");
        assert.equal(memory.text, "A-self");
        // Source fields projected as null instead of undefined.
        assert.equal(memory.sourceCandidateId, null);
        assert.equal(memory.embedding, null);
    });

    it("filters by scope / type / status inside one character world", async () => {
        await seedMemory(memoryStore, { scope: "user", type: "fact", text: "u-fact" });
        await seedMemory(memoryStore, { scope: "user", type: "preference", text: "u-pref" });
        await seedMemory(memoryStore, { scope: "world", type: "fact", text: "w-fact" });
        await seedMemory(memoryStore, { scope: "user", type: "fact", text: "u-archived", status: "archived" });

        const byScope = await app.agent.get("/v1/debug/memories?characterId=char-A&scope=user").expect(200);
        assert.deepEqual(
            (byScope.body as ListMemoriesResponse).memories.map((m) => m.text).sort(),
            ["u-fact", "u-pref"].sort(),
        );

        const byType = await app.agent.get("/v1/debug/memories?characterId=char-A&type=fact").expect(200);
        assert.deepEqual(
            (byType.body as ListMemoriesResponse).memories.map((m) => m.text).sort(),
            ["u-fact", "w-fact"].sort(),
        );

        // Default status filter is `active`, applied at the route
        // layer (the underlying store has no implicit default).
        const defaultStatus = await app.agent.get("/v1/debug/memories?characterId=char-A").expect(200);
        assert.equal((defaultStatus.body as ListMemoriesResponse).memories.length, 3);

        // Explicit `status=archived` surfaces it.
        const archived = await app.agent.get("/v1/debug/memories?characterId=char-A&status=archived").expect(200);
        assert.deepEqual(
            (archived.body as ListMemoriesResponse).memories.map((m) => m.text),
            ["u-archived"],
        );
    });

    it("returns 400 on invalid status / scope / type enum tokens", async () => {
        const badStatus = await app.agent.get("/v1/debug/memories?characterId=char-A&status=archivd").expect(400);
        assert.equal(badStatus.body.code, "memory.debug.invalid_enum_value");
        assert.deepEqual(badStatus.body.params, { param: "status", value: "archivd" });

        const badScope = await app.agent.get("/v1/debug/memories?characterId=char-A&scope=usr").expect(400);
        assert.equal(badScope.body.code, "memory.debug.invalid_enum_value");
        assert.deepEqual(badScope.body.params, { param: "scope", value: "usr" });
    });
});

describe("Memory Debug API — /v1/debug/memory-decisions", () => {
    let app: TestApp;
    let decisionStore: StubMemoryDecisionStore;

    beforeEach(() => {
        app = createTestApp();
        decisionStore = app.stores.memoryDecision as StubMemoryDecisionStore;
    });
    afterEach(() => app.cleanup());

    it("returns only the current user's decisions", async () => {
        await seedDecision(decisionStore, { userId: "default", candidateId: "c-1" });
        await seedDecision(decisionStore, { userId: "other", candidateId: "c-2" });

        const res = await app.agent.get("/v1/debug/memory-decisions").expect(200);
        const body = res.body as ListMemoryDecisionsResponse;
        assert.equal(body.decisions.length, 1);
        const decision: MemoryDecisionInfo = body.decisions[0]!;
        assert.equal(decision.userId, "default");
        assert.equal(decision.candidateId, "c-1");
    });

    it("filters by characterId, candidateId, and decision", async () => {
        await seedDecision(decisionStore, { characterId: "char-A", candidateId: "c-1", decision: "create" });
        await seedDecision(decisionStore, { characterId: "char-A", candidateId: "c-2", decision: "ignore_duplicate" });
        await seedDecision(decisionStore, { characterId: "char-B", candidateId: "c-3", decision: "create" });

        const byChar = await app.agent.get("/v1/debug/memory-decisions?characterId=char-A").expect(200);
        assert.equal((byChar.body as ListMemoryDecisionsResponse).decisions.length, 2);
        for (const d of (byChar.body as ListMemoryDecisionsResponse).decisions) {
            assert.equal(d.characterId, "char-A");
        }

        const byCandidate = await app.agent.get("/v1/debug/memory-decisions?candidateId=c-3").expect(200);
        assert.equal((byCandidate.body as ListMemoryDecisionsResponse).decisions.length, 1);
        assert.equal((byCandidate.body as ListMemoryDecisionsResponse).decisions[0]!.characterId, "char-B");

        const byDecision = await app.agent.get("/v1/debug/memory-decisions?decision=create").expect(200);
        assert.equal((byDecision.body as ListMemoryDecisionsResponse).decisions.length, 2);

        const byDecisionList = await app.agent
            .get("/v1/debug/memory-decisions?decision=create,ignore_duplicate")
            .expect(200);
        assert.equal((byDecisionList.body as ListMemoryDecisionsResponse).decisions.length, 3);
    });

    it("projects record fields including null for missing memoryId / reason", async () => {
        await decisionStore.appendDecision({
            candidateId: "c-fail",
            userId: "default",
            characterId: "char-A",
            decision: "embedding_failed",
            reason: "provider down",
            similarity: [{ memoryId: "m-1", similarity: 0.42, text: "old" }],
            policyVersion: 1,
            createdAt: NOW,
        });

        const res = await app.agent.get("/v1/debug/memory-decisions").expect(200);
        const decision = (res.body as ListMemoryDecisionsResponse).decisions[0]!;
        assert.equal(decision.decision, "embedding_failed");
        assert.equal(decision.memoryId, null);
        assert.equal(decision.reason, "provider down");
        assert.deepEqual(decision.similarity, [{ memoryId: "m-1", similarity: 0.42, text: "old" }]);
    });
});

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
            await app.agent.get("/v1/debug/memories?characterId=char-A").expect(401);
            await app.agent.get("/v1/debug/memory-decisions").expect(401);
        } finally {
            app.cleanup();
        }
    });
});
