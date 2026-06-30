import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    DEFAULT_MEMORY_SETTINGS,
    MEMORY_SCHEMA_VERSION,
    MemoryRetainedConsolidationProcessor,
} from "../src/memory/index.js";
import type {
    ConsolidationCandidateLookup,
    ConsolidationCharacterContextProvider,
    MemoryConsolidationJudgeInput,
    MemoryConsolidationJudgeProvider,
    MemoryConsolidationJudgeResult,
    MemoryEmbedding,
    MemoryRetainedRecord,
    MemorySettings,
    MemoryStagingRecord,
} from "../src/memory/index.js";
import {
    makeFakeEmbeddingProvider,
    makeFixedClock,
    makeInMemoryMemoryStores,
    makeSequentialIds,
    type InMemoryMemoryStores,
} from "./helpers/memoryFakes.js";

const NOW = "2026-07-01T00:00:00.000Z";
const USER = "u1";
const CHAR = "c1";

function makeEmbedding(dim = 8): MemoryEmbedding {
    return {
        vector: new Array<number>(dim).fill(0).map((_, i) => (i === 0 ? 1 : 0)),
        provider: "fake.embed",
        model: "fake-model",
        dim,
        version: 1,
        createdAt: NOW,
    };
}

function seedStaging(
    stores: InMemoryMemoryStores,
    overrides: Partial<MemoryStagingRecord> = {},
): MemoryStagingRecord {
    const record: MemoryStagingRecord = {
        id: "staging-1",
        userId: USER,
        characterId: CHAR,
        scope: "user",
        type: "fact",
        text: "user lives in Tokyo",
        normalizedText: "user lives in tokyo",
        relatedEntities: ["Tokyo"],
        tags: [],
        status: "pending",
        statusReason: undefined,
        occurrenceCount: 2,
        firstSeenAt: "2026-06-01T00:00:00.000Z",
        lastSeenAt: "2026-06-30T00:00:00.000Z",
        embedding: makeEmbedding(),
        schemaVersion: MEMORY_SCHEMA_VERSION,
        createdAt: "2026-06-01T00:00:00.000Z",
        updatedAt: "2026-06-30T00:00:00.000Z",
        ...overrides,
    };
    return stores.stagingStore.seedStaging(record);
}

function makeJudge(result: MemoryConsolidationJudgeResult): MemoryConsolidationJudgeProvider {
    return {
        async judge(_input: MemoryConsolidationJudgeInput): Promise<MemoryConsolidationJudgeResult> {
            return result;
        },
    };
}

const characterContext: ConsolidationCharacterContextProvider = {
    async get() {
        return { displayName: "Alice", personaSummary: "a friendly companion" };
    },
};

const emptyCandidateLookup: ConsolidationCandidateLookup = {
    async listForStaging() {
        return [];
    },
};

function makeProcessor(
    stores: InMemoryMemoryStores,
    judge: MemoryConsolidationJudgeProvider,
    settingsOverrides: Partial<MemorySettings["retained"]> = {},
) {
    const settings: MemorySettings = {
        ...DEFAULT_MEMORY_SETTINGS,
        retained: {
            ...DEFAULT_MEMORY_SETTINGS.retained,
            enabled: true,
            ...settingsOverrides,
        },
    };
    return new MemoryRetainedConsolidationProcessor({
        stagingStore: stores.stagingStore,
        retainedStore: stores.retainedStore,
        decisionStore: stores.consolidationDecisionStore,
        judgeProvider: judge,
        embeddingProvider: makeFakeEmbeddingProvider({ dim: 8 }),
        characterContext,
        candidateLookup: emptyCandidateLookup,
        clock: makeFixedClock(NOW),
        ids: makeSequentialIds("ret"),
        settings,
    });
}

describe("MemoryRetainedConsolidationProcessor", () => {
    it("create: promotes a staging row to a new retained memory", async () => {
        const stores = makeInMemoryMemoryStores();
        seedStaging(stores);
        const processor = makeProcessor(stores, makeJudge({
            action: "create",
            text: "User lives in Tokyo.",
            importance: 4,
            reasoning: "stable location fact",
        }));

        const { outcomes } = await processor.processPending({ userId: USER, characterId: CHAR });

        assert.equal(outcomes.length, 1);
        assert.equal(outcomes[0]!.action, "create");
        assert.equal(outcomes[0]!.auditStatus, "applied");
        assert.equal(outcomes[0]!.stagingStatus, "processed");

        const retained = stores.retainedStore.snapshotAll();
        assert.equal(retained.length, 1);
        assert.equal(retained[0]!.text, "User lives in Tokyo.");
        assert.equal(retained[0]!.importance, 4);
        assert.equal(retained[0]!.occurrenceCount, 2);
        assert.equal(retained[0]!.sourceStagingId, "staging-1");

        const staging = stores.stagingStore.snapshotAll()[0]!;
        assert.equal(staging.status, "processed");

        const decisions = stores.consolidationDecisionStore.snapshotAll();
        assert.equal(decisions.length, 1);
        assert.equal(decisions[0]!.status, "applied");
        assert.equal(decisions[0]!.createdRetainedMemoryId, retained[0]!.id);
    });

    it("update: rewrites an existing retained memory and accumulates occurrence", async () => {
        const stores = makeInMemoryMemoryStores();
        const existing = stores.retainedStore.seedRetained({
            userId: USER,
            characterId: CHAR,
            scope: "user",
            type: "fact",
            text: "User lives in Japan.",
            normalizedText: "user lives in japan",
            relatedEntities: [],
            tags: [],
            status: "active",
            importance: 3,
            occurrenceCount: 1,
            firstSeenAt: "2026-05-01T00:00:00.000Z",
            lastSeenAt: "2026-05-01T00:00:00.000Z",
            embedding: makeEmbedding(),
            createdAt: "2026-05-01T00:00:00.000Z",
            updatedAt: "2026-05-01T00:00:00.000Z",
        });
        seedStaging(stores);

        const processor = makeProcessor(stores, makeJudge({
            action: "update",
            targetRetainedMemoryId: existing.id,
            text: "User lives in Tokyo, Japan.",
            importance: 4,
            reasoning: "refine with city",
        }));

        const { outcomes } = await processor.processPending({ userId: USER, characterId: CHAR });

        assert.equal(outcomes[0]!.action, "update");
        assert.equal(outcomes[0]!.auditStatus, "applied");

        const retained = stores.retainedStore.snapshotAll();
        assert.equal(retained.length, 1);
        assert.equal(retained[0]!.text, "User lives in Tokyo, Japan.");
        assert.equal(retained[0]!.importance, 4);
        // occurrence accumulates: 1 (existing) + 2 (staging) = 3
        assert.equal(retained[0]!.occurrenceCount, 3);
    });

    it("merge: updates the target and archives the redundant rows", async () => {
        const stores = makeInMemoryMemoryStores();
        const target = stores.retainedStore.seedRetained({
            id: "target",
            userId: USER, characterId: CHAR, scope: "user", type: "fact",
            text: "User lives in Japan.", normalizedText: "user lives in japan",
            relatedEntities: [], tags: [], status: "active", importance: 3,
            occurrenceCount: 1, firstSeenAt: NOW, lastSeenAt: NOW,
            embedding: makeEmbedding(), createdAt: NOW, updatedAt: NOW,
        });
        const redundant = stores.retainedStore.seedRetained({
            id: "redundant",
            userId: USER, characterId: CHAR, scope: "user", type: "fact",
            text: "User is in Asia.", normalizedText: "user is in asia",
            relatedEntities: [], tags: [], status: "active", importance: 2,
            occurrenceCount: 1, firstSeenAt: NOW, lastSeenAt: NOW,
            embedding: makeEmbedding(), createdAt: NOW, updatedAt: NOW,
        });
        seedStaging(stores);

        const processor = makeProcessor(stores, makeJudge({
            action: "merge",
            targetRetainedMemoryId: target.id,
            text: "User lives in Tokyo, Japan.",
            archiveRetainedMemoryIds: [redundant.id],
            reasoning: "merge overlapping facts",
        }));

        const { outcomes } = await processor.processPending({ userId: USER, characterId: CHAR });
        assert.equal(outcomes[0]!.action, "merge");
        assert.deepEqual(outcomes[0]!.archivedRetainedMemoryIds, [redundant.id]);

        const byId = new Map(stores.retainedStore.snapshotAll().map((r) => [r.id, r]));
        assert.equal(byId.get("target")!.text, "User lives in Tokyo, Japan.");
        assert.equal(byId.get("redundant")!.status, "archived");
    });

    it("ignore: writes an applied audit but no retained row", async () => {
        const stores = makeInMemoryMemoryStores();
        seedStaging(stores);
        const processor = makeProcessor(stores, makeJudge({
            action: "ignore",
            reasoning: "not worth keeping",
        }));

        const { outcomes } = await processor.processPending({ userId: USER, characterId: CHAR });
        assert.equal(outcomes[0]!.action, "ignore");
        assert.equal(outcomes[0]!.auditStatus, "applied");
        assert.equal(stores.retainedStore.snapshotAll().length, 0);
        assert.equal(stores.stagingStore.snapshotAll()[0]!.status, "processed");
    });

    it("rejects invalid judge output (unknown target id) and fails the staging row", async () => {
        const stores = makeInMemoryMemoryStores();
        seedStaging(stores);
        const processor = makeProcessor(stores, makeJudge({
            action: "update",
            targetRetainedMemoryId: "does-not-exist",
            text: "whatever",
            reasoning: "bad id",
        }));

        const { outcomes } = await processor.processPending({ userId: USER, characterId: CHAR });
        assert.equal(outcomes[0]!.auditStatus, "rejected");
        assert.equal(outcomes[0]!.stagingStatus, "failed");
        assert.equal(stores.retainedStore.snapshotAll().length, 0);

        const decisions = stores.consolidationDecisionStore.snapshotAll();
        assert.equal(decisions[0]!.status, "rejected");
    });

    it("is idempotent: a staging row already applied is not reprocessed", async () => {
        const stores = makeInMemoryMemoryStores();
        seedStaging(stores);
        const processor = makeProcessor(stores, makeJudge({
            action: "create",
            text: "User lives in Tokyo.",
            importance: 4,
            reasoning: "first run",
        }));

        await processor.processPending({ userId: USER, characterId: CHAR });
        // reset staging back to pending to simulate a retry over the same row
        await stores.stagingStore.updateStatus({
            memoryStagingId: "staging-1",
            status: "pending",
            updatedAt: NOW,
        });

        const { outcomes } = await processor.processPending({ userId: USER, characterId: CHAR });
        assert.equal(outcomes[0]!.statusReason, "idempotent_already_applied");
        // still only one retained row from the first run
        assert.equal(stores.retainedStore.snapshotAll().length, 1);
    });
});
