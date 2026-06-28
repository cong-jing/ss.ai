import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    DEFAULT_MEMORY_SETTINGS,
    MemoryCandidateProcessor,
    MemoryCandidateRecorder,
    MemoryDecisionRecorder,
    MemoryEmbeddingStep,
    MemoryPipelineLogger,
    MemoryPipelineService,
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
    const pipelineLogger = new MemoryPipelineLogger(logger, settings);
    const candidateRecorder = new MemoryCandidateRecorder({
        candidateStore: stores.candidateStore,
        clock,
        ids,
        logger,
    });
    const embeddingProvider = makeFakeEmbeddingProvider();
    const embeddingStep = new MemoryEmbeddingStep(embeddingProvider, pipelineLogger);
    const decisionRecorder = new MemoryDecisionRecorder({
        candidateStore: stores.candidateStore,
        decisionStore: stores.decisionStore,
        clock,
    });
    const candidateProcessor = new MemoryCandidateProcessor({
        candidateStore: stores.candidateStore,
        memoryStore: stores.memoryStore,
        decisionStore: stores.decisionStore,
        embeddingStep,
        decisionRecorder,
        clock,
        pipelineLogger,
        settings,
    });
    const service = new MemoryPipelineService({
        candidateRecorder,
        candidateProcessor,
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
        // - `recordedCount` is zero
        assert.equal(result.recordedCount, 0);
        // - no candidate row was persisted
        assert.equal(stores.candidateStore.snapshotAll().length, 0);
        // - the embedding provider was never reached
        assert.equal(embeddingProvider.calls.length, 0);

        // Pipeline-level log semantics:
        // - `pipelineCompleted` must NOT have been logged (the
        //   recorder failed and dashboards must not see a clean
        //   completion).
        const completedLogs = [...logger.debugEvents, ...logger.warnEvents, ...logger.infoEvents]
            .filter((entry) => entry.message === "memory.pipeline.completed");
        assert.equal(completedLogs.length, 0, "pipelineCompleted must not be emitted on store outage");

        // - `candidatesRecordingFailed` and `pipelineFailed` should
        //   both fire so operators see a failure rather than silence.
        const recordingFailedLogs = logger.warnEvents.filter(
            (entry) => entry.message === "memory.pipeline.candidates_recording_failed",
        );
        assert.equal(recordingFailedLogs.length, 1);

        const pipelineFailedLogs = logger.warnEvents.filter(
            (entry) => entry.message === "memory.pipeline.failed",
        );
        assert.equal(pipelineFailedLogs.length, 1);
        const failedPayload = pipelineFailedLogs[0]!.payload as { stage?: string; error?: string };
        assert.equal(failedPayload.stage, "record");
        assert.equal(failedPayload.error, storeOutage.message);
    });
});
