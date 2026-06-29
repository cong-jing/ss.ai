/**
 * Public barrel for the memory subsystem.
 *
 * Everything memory-related (the pipeline service, stage helpers,
 * types, logging) is exported from this single file. Stage folders
 * (`candidate/`, `embedding/`, `ranking/`, etc.) are an implementation
 * detail and consumers must not reach past this barrel.
 */

// ---------- Top-level service ----------
export { MemoryPipelineService } from "./MemoryPipelineService.js";
export type {
    HandleChatTurnCandidatesInput,
    HandleChatTurnCandidatesResult,
    MemoryPipelineServiceDeps,
    MemoryStagingProcessingOutcome,
} from "./MemoryPipelineService.js";
export { createMemoryPipelineService } from "./createMemoryPipelineService.js";
export type { CreateMemoryPipelineServiceInput } from "./createMemoryPipelineService.js";

// ---------- Settings & cross-cutting ----------
export {
    DEFAULT_MEMORY_SETTINGS,
    type MemorySettings,
    type MemoryStagingSettings,
    type MemoryRetainedSettings,
} from "./settings.js";
export {
    MEMORY_SCHEMA_VERSION,
    type MemoryCandidateSource,
    type MemoryClock,
    type MemoryIdGenerator,
    type MemoryLogger,
} from "./types.js";

// ---------- Logging ----------
export { MemoryPipelineLogger } from "./logging/MemoryPipelineLogger.js";
export {
    MEMORY_PIPELINE_LOG_EVENTS,
    type MemoryPipelineLogEvent,
} from "./logging/memoryPipelineLogEvents.js";

// ---------- Candidate stage ----------
export { normalizeMemoryText } from "./candidate/textNormalization.js";
export { MemoryCandidateRecorder } from "./candidate/MemoryCandidateRecorder.js";
export type {
    MemoryCandidateRecorderDeps,
    RecordMemoryCandidatesInput,
    RecordMemoryCandidatesResult,
} from "./candidate/MemoryCandidateRecorder.js";
export {
    MEMORY_CANDIDATE_STATUSES,
    type MemoryCandidateDraft,
    type MemoryCandidateRecord,
    type MemoryCandidateStatus,
} from "./candidate/candidateTypes.js";
export type {
    AppendMemoryCandidatesInput,
    ListMemoryCandidatesInput,
    ListPendingMemoryCandidatesInput,
    MemoryCandidateStore,
    UpdateMemoryCandidateStatusInput,
} from "./candidate/candidatePorts.js";

// ---------- Embedding stage ----------
export {
    MEMORY_EMBED_PURPOSE,
    ModelClientMemoryEmbeddingProvider,
    ModelClientMemoryEmbeddingProviderError,
    type ModelClientMemoryEmbeddingProviderDeps,
    type ModelClientMemoryEmbeddingProviderErrorCode,
} from "./embedding/ModelClientMemoryEmbeddingProvider.js";
export { MemoryEmbeddingStep } from "./embedding/MemoryEmbeddingStep.js";
export type { MemoryEmbeddingStepOutcome } from "./embedding/MemoryEmbeddingStep.js";
export type {
    MemoryEmbedding,
    MemoryEmbedInput,
    MemoryEmbedResult,
    MemoryEmbeddingProvider,
} from "./embedding/embeddingPorts.js";

// ---------- Staging stage ----------
export {
    MEMORY_STAGING_STATUSES,
    type MemoryStagingRecord,
    type MemoryStagingSourceRecord,
    type MemoryStagingStatus,
} from "./staging/memoryStagingTypes.js";
export type {
    CreateMemoryStagingInput,
    FindBySourceCandidateInput,
    FindExactStagingInput,
    IncrementMemoryStagingOccurrenceInput,
    LinkStagingSourceInput,
    ListMemoryStagingInput,
    MemoryStagingStore,
} from "./staging/memoryStagingPorts.js";
export { MemoryStagingProcessor } from "./staging/MemoryStagingProcessor.js";
export type {
    MemoryStagingProcessorDeps,
    ProcessCandidatesInput,
    ProcessCandidatesResult,
    ProcessPendingCandidatesInput,
    ProcessPendingCandidatesResult,
} from "./staging/MemoryStagingProcessor.js";

// ---------- Retained store (Batch 4 placeholder) ----------
export {
    MEMORY_RETAINED_STATUSES,
    type ListMemoryRetainedInput,
    type MemoryRetainedRecord,
    type MemoryRetainedStatus,
    type MemoryRetainedStore,
} from "./stores/memoryRetainedStorePort.js";

// ---------- Ranking stage ----------
export {
    cosineSimilarity,
    emptyMemoryRankSkipBreakdown,
    signaturesMatch,
    totalSkipped,
    type EmbeddingSignature,
    type MemoryRankSkipBreakdown,
} from "./ranking/similarity.js";
export {
    rankSimilarMemories,
    type RankSimilarMemoriesOptions,
    type RankSimilarMemoriesResult,
    type RankableMemory,
    type RankedMemory,
} from "./ranking/rankSimilarMemories.js";

// ---------- Decision helpers (pure) ----------
export {
    decideBySimilarity,
    defaultMemoryDecisionPolicy,
    isLowValueCandidate,
    type LowValueAssessment,
    type MemoryDecisionPolicy,
    type SimilarityDecision,
    type SimilarityDecisionKind,
} from "./decision/decisionPolicy.js";
