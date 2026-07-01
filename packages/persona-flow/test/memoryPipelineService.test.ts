import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    DEFAULT_MEMORY_SETTINGS,
    MemoryCandidateRecorder,
    MemoryEmbeddingStep,
    MemoryPipelineLogger,
    MemoryPipelineService,
    MemoryStagingProcessor,
} from "../src/memory/index.js";
import type { MemoryCandidateSource } from "../src/memory/index.js";
import {
    makeFakeEmbeddingProvider,
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

interface BundleOptions {
    candidateStore?: { failOnAppend?: Error };
}

function buildPipelineBundle(options: BundleOptions = {}) {
    const stores = makeInMemoryMemoryStores({ candidateStore: options.candidateStore });
    const clock = makeFixedClock();
    const ids = makeSequentialIds();
    const settings = DEFAULT_MEMORY_SETTINGS;
    const logger = makeRecordingLogger();
    const pipelineLogger = new MemoryPipelineLogger(logger);
    const candidateRecorder = new MemoryCandidateRecorder({
        candidateStore: stores.candidateStore,
        clock,
        ids,
        logger,
    });
    const embeddingProvider = makeFakeEmbeddingProvider();
    const embeddingStep = new MemoryEmbeddingStep(embeddingProvider, pipelineLogger);
    const stagingProcessor = new MemoryStagingProcessor({
        candidateStore: stores.candidateStore,
        stagingStore: stores.stagingStore,
        embeddingStep,
        clock,
        pipelineLogger,
        settings,
    });
    const service = new MemoryPipelineService({
        candidateRecorder,
        stagingProcessor,
        pipelineLogger,
        settings,
    });
    return { stores, service, logger, embeddingProvider };
}

describe("MemoryPipelineService", () => {
    it("logs pipelineFailed (not pipelineCompleted) when the candidate store reports an outage", async () => {
        const storeOutage = new Error("simulated candidate store outage");
        const { service, logger, embeddingProvider, stores } = buildPipelineBundle({
            candidateStore: { failOnAppend: storeOutage },
        });

        const result = await service.handleChatTurnCandidates({
            source: makeSource(),
            candidates: [{ scope: "user", type: "fact", text: "A fact that never makes it." }],
        });

        // Surface the recorder outage:
        assert.equal(result.recordedCount, 0);
        assert.equal(stores.candidateStore.snapshotAll().length, 0);
        assert.equal(embeddingProvider.calls.length, 0);

        // `pipelineCompleted` must NOT have been logged.
        const completedLogs = [...logger.debugEvents, ...logger.warnEvents, ...logger.infoEvents]
            .filter((entry) => entry.message === "memory.pipeline.completed");
        assert.equal(completedLogs.length, 0, "pipelineCompleted must not be emitted on store outage");

        const recordingFailedLogs = logger.warnEvents.filter(
            (entry) => entry.message === "memory.pipeline.candidates_recording_failed",
        );
        assert.equal(recordingFailedLogs.length, 1);
        const pipelineFailedLogs = logger.warnEvents.filter(
            (entry) => entry.message === "memory.pipeline.failed",
        );
        assert.equal(pipelineFailedLogs.length, 1);
    });

    it("processes candidates inline by default and produces staging rows", async () => {
        const { service, stores } = buildPipelineBundle();

        const result = await service.handleChatTurnCandidates({
            source: makeSource(),
            candidates: [{ scope: "user", type: "fact", text: "User loves to ski." }],
        });

        assert.equal(result.recordedCount, 1);
        assert.ok(result.processed);
        assert.equal(result.processed!.outcomes.length, 1);
        assert.equal(result.processed!.outcomes[0]!.stagingOutcome, "created");
        assert.equal(stores.stagingStore.snapshotAll().length, 1);
    });

    it("skips processing in record_only mode but still records candidates", async () => {
        const stores = makeInMemoryMemoryStores();
        const clock = makeFixedClock();
        const ids = makeSequentialIds();
        const settings = {
            ...DEFAULT_MEMORY_SETTINGS,
            candidateProcessingMode: "record_only" as const,
        };
        const logger = makeRecordingLogger();
        const pipelineLogger = new MemoryPipelineLogger(logger);
        const candidateRecorder = new MemoryCandidateRecorder({
            candidateStore: stores.candidateStore,
            clock,
            ids,
            logger,
        });
        const embeddingProvider = makeFakeEmbeddingProvider();
        const embeddingStep = new MemoryEmbeddingStep(embeddingProvider, pipelineLogger);
        const stagingProcessor = new MemoryStagingProcessor({
            candidateStore: stores.candidateStore,
            stagingStore: stores.stagingStore,
            embeddingStep,
            clock,
            pipelineLogger,
            settings,
        });
        const service = new MemoryPipelineService({
            candidateRecorder,
            stagingProcessor,
            pipelineLogger,
            settings,
        });

        const result = await service.handleChatTurnCandidates({
            source: makeSource(),
            candidates: [{ scope: "user", type: "fact", text: "User likes ramen." }],
        });

        assert.equal(result.recordedCount, 1);
        assert.equal(result.processed, undefined);
        assert.equal(embeddingProvider.calls.length, 0);
        assert.equal(stores.stagingStore.snapshotAll().length, 0);
        // Candidate stays pending awaiting an async worker.
        assert.equal(stores.candidateStore.snapshotAll()[0]!.status, "pending");
    });

    it("returns skippedReason='disabled' when the pipeline is turned off", async () => {
        const stores = makeInMemoryMemoryStores();
        const clock = makeFixedClock();
        const ids = makeSequentialIds();
        const settings = { ...DEFAULT_MEMORY_SETTINGS, enabled: false };
        const logger = makeRecordingLogger();
        const pipelineLogger = new MemoryPipelineLogger(logger);
        const candidateRecorder = new MemoryCandidateRecorder({
            candidateStore: stores.candidateStore,
            clock,
            ids,
            logger,
        });
        const embeddingProvider = makeFakeEmbeddingProvider();
        const embeddingStep = new MemoryEmbeddingStep(embeddingProvider, pipelineLogger);
        const stagingProcessor = new MemoryStagingProcessor({
            candidateStore: stores.candidateStore,
            stagingStore: stores.stagingStore,
            embeddingStep,
            clock,
            pipelineLogger,
            settings,
        });
        const service = new MemoryPipelineService({
            candidateRecorder,
            stagingProcessor,
            pipelineLogger,
            settings,
        });

        const result = await service.handleChatTurnCandidates({
            source: makeSource(),
            candidates: [{ scope: "user", type: "fact", text: "x" }],
        });

        assert.equal(result.skippedReason, "disabled");
        assert.equal(stores.candidateStore.snapshotAll().length, 0);
    });

    it("processPendingCandidates drains pending rows by (userId, characterId)", async () => {
        const { service, stores } = buildPipelineBundle();
        // Seed by going through the inline pipeline first to populate
        // the candidate rows in `pending` status by manually flipping
        // them back. Easier: seed via the in-memory store directly.
        stores.candidateStore.seedCandidate({
            id: "cand-pending",
            source: makeSource(),
            seq: 0,
            scope: "user",
            type: "fact",
            text: "pending row to drain",
            relatedEntities: [],
            tags: [],
            status: "pending",
            schemaVersion: 1,
            createdAt: "2026-06-27T00:00:00.000Z",
            updatedAt: "2026-06-27T00:00:00.000Z",
        });

        const result = await service.processPendingCandidates({
            userId: "u1",
            characterId: "c1",
            limit: 10,
        });

        assert.equal(result.outcomes.length, 1);
        assert.equal(result.outcomes[0]!.candidateId, "cand-pending");
        assert.equal(result.outcomes[0]!.stagingOutcome, "created");
    });
});
