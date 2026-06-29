import type { ModelAssignmentMap } from "@ss-ai/contracts";
import type { ModelClient } from "../llm/modelClient.js";
import type { AppStores } from "../stores/appStores.js";
import { MemoryCandidateRecorder } from "./candidate/MemoryCandidateRecorder.js";
import { MemoryEmbeddingStep } from "./embedding/MemoryEmbeddingStep.js";
import { ModelClientMemoryEmbeddingProvider } from "./embedding/ModelClientMemoryEmbeddingProvider.js";
import { MemoryPipelineLogger } from "./logging/MemoryPipelineLogger.js";
import { MemoryPipelineService } from "./MemoryPipelineService.js";
import type { MemorySettings } from "./settings.js";
import { DEFAULT_MEMORY_SETTINGS } from "./settings.js";
import { MemoryStagingProcessor } from "./staging/MemoryStagingProcessor.js";
import type {
    MemoryClock,
    MemoryIdGenerator,
    MemoryLogger,
} from "./types.js";

/**
 * Wires every pipeline stage from a small number of shared
 * dependencies (stores, model client, settings).
 *
 * Lives next to the service file because both are top-level
 * composition points: the service is what consumers call, the
 * factory is what consumers build. Anything stage-specific (logger,
 * step, processor) stays one folder down.
 *
 * Callers that need to override individual sub-components (e.g.
 * inject a fake embedding provider in a test) can pass the
 * `overrides` bag.
 */
export interface CreateMemoryPipelineServiceInput {
    stores: AppStores;
    modelClient: ModelClient;
    settings?: MemorySettings;
    defaultModelAssignments?: ModelAssignmentMap;
    defaultProviderApiKeys?: Record<string, string>;
    /** Required: every stage logger emits via this. */
    logger?: MemoryLogger;
    /** Used by stages to stamp `createdAt` / `updatedAt`. Defaults to `Date.now()`. */
    clock?: MemoryClock;
    /** Used by adapters/tests; defaults to `crypto.randomUUID()`. */
    ids?: MemoryIdGenerator;
    /**
     * Optional component overrides. Mainly for tests that want to
     * swap one piece (e.g. embedding provider) without re-building
     * every stage from scratch.
     */
    overrides?: {
        embeddingProvider?: ConstructorParameters<typeof MemoryEmbeddingStep>[0];
        stagingProcessor?: MemoryStagingProcessor;
        candidateRecorder?: MemoryCandidateRecorder;
    };
}

export function createMemoryPipelineService(input: CreateMemoryPipelineServiceInput): MemoryPipelineService {
    const settings = input.settings ?? DEFAULT_MEMORY_SETTINGS;
    const clock: MemoryClock = input.clock ?? { nowIso: () => new Date().toISOString() };
    const ids: MemoryIdGenerator = input.ids ?? { randomId: () => crypto.randomUUID() };

    const pipelineLogger = new MemoryPipelineLogger(input.logger);

    const embeddingProvider = input.overrides?.embeddingProvider ?? new ModelClientMemoryEmbeddingProvider({
        modelClient: input.modelClient,
        appStores: input.stores,
        ...(input.defaultModelAssignments ? { defaultModelAssignments: input.defaultModelAssignments } : {}),
        ...(input.defaultProviderApiKeys ? { defaultProviderApiKeys: input.defaultProviderApiKeys } : {}),
        embeddingVersion: settings.embedding.version,
    });

    const embeddingStep = new MemoryEmbeddingStep(embeddingProvider, pipelineLogger);

    const candidateRecorder = input.overrides?.candidateRecorder ?? new MemoryCandidateRecorder({
        candidateStore: input.stores.memoryCandidate,
        clock,
        ids,
        ...(input.logger ? { logger: input.logger } : {}),
    });

    const stagingProcessor = input.overrides?.stagingProcessor ?? new MemoryStagingProcessor({
        candidateStore: input.stores.memoryCandidate,
        stagingStore: input.stores.memoryStaging,
        embeddingStep,
        clock,
        pipelineLogger,
        settings,
    });

    return new MemoryPipelineService({
        candidateRecorder,
        stagingProcessor,
        pipelineLogger,
        settings,
    });
}
