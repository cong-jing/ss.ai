import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    DEFAULT_MEMORY_SETTINGS,
    MEMORY_PIPELINE_LOG_EVENTS,
    MEMORY_SCHEMA_VERSION,
    MemoryEmbeddingStep,
    MemoryPipelineLogger,
    MemoryStagingProcessor,
    normalizeMemoryText,
} from "../src/memory/index.js";
import type {
    MemoryCandidateRecord,
    MemoryCandidateSource,
    MemorySettings,
} from "../src/memory/index.js";
import {
    makeFakeEmbeddingProvider,
    makeFixedClock,
    makeInMemoryMemoryStores,
    makeRecordingLogger,
    makeSequentialIds,
    type InMemoryMemoryStores,
} from "./helpers/memoryFakes.js";

const NOW = "2026-06-27T00:00:00.000Z";

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

let candidateIdCounter = 1;
function makeCandidate(text: string, overrides: Partial<MemoryCandidateRecord> = {}): MemoryCandidateRecord {
    return {
        id: `cand-${candidateIdCounter++}`,
        source: makeSource(),
        seq: 0,
        scope: "user",
        type: "fact",
        text,
        relatedEntities: [],
        tags: [],
        status: "pending",
        schemaVersion: MEMORY_SCHEMA_VERSION,
        createdAt: NOW,
        updatedAt: NOW,
        ...overrides,
    };
}

function seedCandidate(
    stores: InMemoryMemoryStores,
    text: string,
    overrides: Partial<MemoryCandidateRecord> = {},
): MemoryCandidateRecord {
    const record = makeCandidate(text, overrides);
    stores.candidateStore.seedCandidate(record);
    return record;
}

interface ProcessorTestOptions {
    embedDim?: number;
    embedFails?: Error;
    logger?: ReturnType<typeof makeRecordingLogger>;
    settingsOverrides?: Partial<MemorySettings>;
}

function makeProcessor(stores: InMemoryMemoryStores, options: ProcessorTestOptions = {}) {
    const embeddingProvider = makeFakeEmbeddingProvider({
        dim: options.embedDim ?? 8,
        failWith: options.embedFails,
    });
    const settings: MemorySettings = {
        ...DEFAULT_MEMORY_SETTINGS,
        ...(options.settingsOverrides ?? {}),
    };
    const clock = makeFixedClock(NOW);
    const ids = makeSequentialIds("id");
    void ids; // not used by the processor itself; the staging store owns id minting
    const pipelineLogger = new MemoryPipelineLogger(options.logger);
    const embeddingStep = new MemoryEmbeddingStep(embeddingProvider, pipelineLogger);
    const processor = new MemoryStagingProcessor({
        candidateStore: stores.candidateStore,
        stagingStore: stores.stagingStore,
        embeddingStep,
        clock,
        pipelineLogger,
        settings,
    });
    return { processor, embeddingProvider };
}

describe("MemoryStagingProcessor", () => {
    it("creates a fresh staging row when no exact-normalized match exists", async () => {
        const stores = makeInMemoryMemoryStores();
        const { processor } = makeProcessor(stores);
        const candidate = seedCandidate(stores, "user likes green tea");

        const { outcomes } = await processor.processCandidates({ candidates: [candidate] });

        assert.equal(outcomes.length, 1);
        const outcome = outcomes[0]!;
        assert.equal(outcome.stagingOutcome, "created");
        assert.equal(outcome.candidateStatus, "processed");
        assert.equal(outcome.statusReason, "staging_created");
        assert.ok(outcome.stagingId, "created outcome must carry the new stagingId");

        const persistedCandidate = stores.candidateStore.snapshotAll()[0]!;
        assert.equal(persistedCandidate.status, "processed");
        assert.equal(persistedCandidate.statusReason, "staging_created");

        const stagingRows = stores.stagingStore.snapshotAll();
        assert.equal(stagingRows.length, 1);
        assert.equal(stagingRows[0]!.text, "user likes green tea");
        assert.equal(stagingRows[0]!.normalizedText, normalizeMemoryText("user likes green tea"));
        assert.equal(stagingRows[0]!.occurrenceCount, 1);
        assert.equal(stagingRows[0]!.firstSeenAt, candidate.createdAt);
        assert.equal(stagingRows[0]!.lastSeenAt, NOW);
        assert.equal(stagingRows[0]!.embedding?.provider, "fake.embed");

        // First link row points back to the candidate.
        const sources = stores.stagingStore.snapshotSources();
        assert.equal(sources.length, 1);
        assert.equal(sources[0]!.memoryStagingId, stagingRows[0]!.id);
        assert.equal(sources[0]!.candidateId, candidate.id);
    });

    it("aggregates an exact normalized-text duplicate onto the existing staging row", async () => {
        const stores = makeInMemoryMemoryStores();
        const { processor } = makeProcessor(stores);
        const first = seedCandidate(stores, "User Loves Coffee");
        await processor.processCandidates({ candidates: [first] });

        const stagingBefore = stores.stagingStore.snapshotAll();
        assert.equal(stagingBefore.length, 1);
        assert.equal(stagingBefore[0]!.occurrenceCount, 1);

        // Same normalized text, different casing/whitespace.
        const second = seedCandidate(stores, "  user loves coffee  ", { id: "cand-second" });
        const { outcomes } = await processor.processCandidates({ candidates: [second] });

        assert.equal(outcomes[0]!.stagingOutcome, "duplicate");
        assert.equal(outcomes[0]!.candidateStatus, "processed");
        assert.equal(outcomes[0]!.statusReason, "staging_duplicate_normalized_text");
        assert.equal(outcomes[0]!.stagingId, stagingBefore[0]!.id);

        // Still one staging row, occurrence bumped.
        const stagingAfter = stores.stagingStore.snapshotAll();
        assert.equal(stagingAfter.length, 1);
        assert.equal(stagingAfter[0]!.occurrenceCount, 2);

        const sources = stores.stagingStore.snapshotSources();
        assert.equal(sources.length, 2);
        assert.deepEqual(
            sources.map((s) => s.candidateId).sort(),
            [first.id, second.id].sort(),
        );
    });

    it("is idempotent: re-processing a candidate already linked short-circuits without double counting", async () => {
        const stores = makeInMemoryMemoryStores();
        const { processor } = makeProcessor(stores);
        const candidate = seedCandidate(stores, "I love hiking on weekends");

        await processor.processCandidates({ candidates: [candidate] });
        const stagingAfterFirst = stores.stagingStore.snapshotAll();
        assert.equal(stagingAfterFirst.length, 1);
        assert.equal(stagingAfterFirst[0]!.occurrenceCount, 1);

        // Same candidate re-processed (retry path).
        const { outcomes } = await processor.processCandidates({ candidates: [candidate] });
        assert.equal(outcomes[0]!.stagingOutcome, "idempotent");
        assert.equal(outcomes[0]!.candidateStatus, "processed");
        assert.equal(outcomes[0]!.statusReason, "idempotent_already_linked");

        const stagingAfterSecond = stores.stagingStore.snapshotAll();
        assert.equal(stagingAfterSecond[0]!.occurrenceCount, 1, "no double count on retry");
        const sources = stores.stagingStore.snapshotSources();
        assert.equal(sources.length, 1);
    });

    it("idempotent re-run repairs candidate status when a previous run wrote staging but left the candidate pending", async () => {
        // Simulates the partial-failure window the plan documents:
        // staging row + source link were committed in a prior run,
        // but the candidate status update failed (e.g. process
        // crashed between the two awaits). The retry must flip the
        // candidate to `processed/idempotent_already_linked`,
        // otherwise `processPendingCandidates` would loop forever.
        const stores = makeInMemoryMemoryStores();
        const { processor } = makeProcessor(stores);
        const candidate = seedCandidate(stores, "User likes long walks.");

        // First run: writes staging + source link AND flips the candidate.
        await processor.processCandidates({ candidates: [candidate] });
        assert.equal(stores.stagingStore.snapshotSources().length, 1);

        // Force the candidate back to `pending` to simulate the
        // "staging persisted but candidate update was lost" window.
        await stores.candidateStore.updateCandidateStatus({
            candidateId: candidate.id,
            status: "pending",
            statusReason: "",
            updatedAt: NOW,
        });
        const beforeRetry = stores.candidateStore.snapshotAll().find((r) => r.id === candidate.id)!;
        assert.equal(beforeRetry.status, "pending");

        const { outcomes } = await processor.processCandidates({ candidates: [candidate] });
        assert.equal(outcomes[0]!.stagingOutcome, "idempotent");
        assert.equal(outcomes[0]!.candidateStatus, "processed");
        assert.equal(outcomes[0]!.statusReason, "idempotent_already_linked");

        // The retry must have persisted the new candidate status.
        const afterRetry = stores.candidateStore.snapshotAll().find((r) => r.id === candidate.id)!;
        assert.equal(afterRetry.status, "processed");
        assert.equal(afterRetry.statusReason, "idempotent_already_linked");

        // No double counting and no extra source link.
        const staging = stores.stagingStore.snapshotAll();
        assert.equal(staging.length, 1);
        assert.equal(staging[0]!.occurrenceCount, 1);
        assert.equal(stores.stagingStore.snapshotSources().length, 1);
    });

    it("rejects low-value candidates without calling the embedding provider", async () => {
        const stores = makeInMemoryMemoryStores();
        const { processor, embeddingProvider } = makeProcessor(stores);
        const candidate = seedCandidate(stores, "!!");

        const { outcomes } = await processor.processCandidates({ candidates: [candidate] });

        assert.equal(outcomes[0]!.stagingOutcome, "none");
        assert.equal(outcomes[0]!.candidateStatus, "rejected_by_rule");
        assert.ok(outcomes[0]!.statusReason, "low-value outcome must carry a reason");
        assert.equal(embeddingProvider.calls.length, 0);
        assert.equal(stores.candidateStore.snapshotAll()[0]!.status, "rejected_by_rule");
        assert.equal(stores.stagingStore.snapshotAll().length, 0);
    });

    it("marks the candidate failed/embedding_failed when the embedding provider throws", async () => {
        const stores = makeInMemoryMemoryStores();
        const logger = makeRecordingLogger();
        const { processor, embeddingProvider } = makeProcessor(stores, {
            embedFails: new Error("simulated provider outage"),
            logger,
        });
        const candidate = seedCandidate(stores, "a candidate we cannot embed");

        const { outcomes } = await processor.processCandidates({ candidates: [candidate] });

        assert.equal(outcomes[0]!.stagingOutcome, "none");
        assert.equal(outcomes[0]!.candidateStatus, "failed");
        assert.equal(outcomes[0]!.statusReason, "embedding_failed");
        assert.ok(outcomes[0]!.error);
        assert.equal(embeddingProvider.calls.length, 1);
        assert.equal(stores.candidateStore.snapshotAll()[0]!.status, "failed");
        assert.equal(stores.stagingStore.snapshotAll().length, 0);

        // Warning log must triangulate with the candidate row so
        // operators can triage without re-joining DB queries
        // (matches the Batch 3.5 plan: candidateId/userId/
        // characterId/scope/type/reason).
        const failure = logger.warnEvents.find(
            (e) => e.message === MEMORY_PIPELINE_LOG_EVENTS.embeddingFailed,
        );
        assert.ok(failure, "embedding_failed warning must be emitted");
        const payload = failure.payload as Record<string, unknown>;
        assert.equal(payload["candidateId"], candidate.id);
        assert.equal(payload["userId"], candidate.source.userId);
        assert.equal(payload["characterId"], candidate.source.characterId);
        assert.equal(payload["scope"], candidate.scope);
        assert.equal(payload["type"], candidate.type);
        assert.equal(payload["reason"], "simulated provider outage");
    });

    it("isolates per-candidate failures so a poison row does not abort the batch", async () => {
        const stores = makeInMemoryMemoryStores();
        const { processor } = makeProcessor(stores);
        const ok1 = seedCandidate(stores, "first good fact");
        const poison = seedCandidate(stores, "this one explodes");
        const ok2 = seedCandidate(stores, "third good fact");

        // Force the second create to throw exactly once.
        const originalCreate = stores.stagingStore.create.bind(stores.stagingStore);
        let calls = 0;
        stores.stagingStore.create = async (input) => {
            calls += 1;
            if (calls === 2) throw new Error("simulated staging hiccup");
            return originalCreate(input);
        };

        const { outcomes } = await processor.processCandidates({ candidates: [ok1, poison, ok2] });

        assert.equal(outcomes.length, 3);
        assert.equal(outcomes[0]!.stagingOutcome, "created");
        assert.equal(outcomes[1]!.stagingOutcome, "none");
        assert.equal(outcomes[1]!.candidateStatus, "failed");
        assert.equal(outcomes[1]!.statusReason, "staging_create_failed");
        assert.ok(outcomes[1]!.error);
        assert.equal(outcomes[2]!.stagingOutcome, "created");

        const stagingRows = stores.stagingStore.snapshotAll();
        assert.equal(stagingRows.length, 2, "two rows survived the poison candidate");
    });

    it("emits documented stage events when a verbose logger is wired", async () => {
        const stores = makeInMemoryMemoryStores();
        const logger = makeRecordingLogger();
        const { processor } = makeProcessor(stores, { logger });
        const candidate = seedCandidate(stores, "verbose logging fact");

        await processor.processCandidates({ candidates: [candidate] });

        const stageMessages = new Set(logger.debugEvents.map((e) => e.message));
        assert.equal(stageMessages.has(MEMORY_PIPELINE_LOG_EVENTS.candidateProcessingStarted), true);
        assert.equal(stageMessages.has(MEMORY_PIPELINE_LOG_EVENTS.embeddingRequested), true);
        assert.equal(stageMessages.has(MEMORY_PIPELINE_LOG_EVENTS.candidateProcessingCompleted), true);
    });

    it("processPendingCandidates pulls pending candidates for the given (userId, characterId)", async () => {
        const stores = makeInMemoryMemoryStores();
        const { processor } = makeProcessor(stores);
        seedCandidate(stores, "first pending", { id: "cand-A" });
        seedCandidate(stores, "second pending", { id: "cand-B" });
        // Different character must be excluded.
        seedCandidate(stores, "other character", {
            id: "cand-C",
            source: makeSource({ characterId: "c2", assistantMessageId: "a-msg-2" }),
        });

        const result = await processor.processPendingCandidates({
            userId: "u1",
            characterId: "c1",
            limit: 50,
        });

        assert.equal(result.outcomes.length, 2);
        const processedIds = new Set(result.outcomes.map((o) => o.candidateId));
        assert.equal(processedIds.has("cand-A"), true);
        assert.equal(processedIds.has("cand-B"), true);
        assert.equal(processedIds.has("cand-C"), false);

        // The pending row for c2 is still pending.
        const c2 = stores.candidateStore.snapshotAll().find((r) => r.id === "cand-C")!;
        assert.equal(c2.status, "pending");
    });
});
