/**
 * Public barrel for the memory pipeline.
 *
 * External consumers (server, debug API, persona-flow-sqlite,
 * tests) import everything memory-related through this entry point.
 * Stage folders are an implementation detail and may be re-arranged
 * without touching callers.
 */

// ---------- Top-level service ----------
export { MemoryPipelineService } from "./MemoryPipelineService.js";
export type {
    HandleChatTurnCandidatesInput,
    HandleChatTurnCandidatesResult,
    MemoryPipelineServiceDeps,
} from "./MemoryPipelineService.js";
export { createMemoryPipelineService } from "./createMemoryPipelineService.js";
export type { CreateMemoryPipelineServiceInput } from "./createMemoryPipelineService.js";

// ---------- Settings & cross-cutting ----------
export {
    DEFAULT_MEMORY_PIPELINE_SETTINGS,
    type MemoryPipelineSettings,
} from "./memoryPipelineSettings.js";
export {
    MEMORY_SCHEMA_VERSION,
    type MemoryCandidateSource,
    type MemoryClock,
    type MemoryIdGenerator,
    type MemoryLogger,
} from "./memoryPipelineTypes.js";

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
    MemoryCandidateStore,
    SaveCandidateEmbeddingInput,
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

// ---------- Stores ----------
export {
    MEMORY_STATUSES,
    type ActiveMemoryRecord,
    type CreateMemoryInput,
    type FindExactActiveMemoryInput,
    type ListActiveMemoriesInput,
    type MemoryStatus,
    type MemoryStore,
    type SaveMemoryEmbeddingInput,
} from "./stores/activeMemoryStorePort.js";

// ---------- Duplicate stage ----------
export { checkExactDuplicate } from "./duplicate/exactDuplicateStep.js";

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
    type RankedMemory,
} from "./ranking/rankSimilarMemories.js";

// ---------- Decision stage ----------
export {
    MEMORY_DECISION_KINDS,
    type AppendMemoryDecisionInput,
    type ListMemoryDecisionsInput,
    type MemoryDecisionKind,
    type MemoryDecisionRecord,
    type MemoryDecisionStore,
    type MemorySimilaritySummaryEntry,
} from "./decision/decisionPorts.js";
export {
    decideBySimilarity,
    defaultMemoryDecisionPolicy,
    isLowValueCandidate,
    type LowValueAssessment,
    type MemoryDecisionPolicy,
    type SimilarityDecision,
} from "./decision/decisionPolicy.js";
export { MemoryDecisionRecorder } from "./decision/MemoryDecisionRecorder.js";
export type {
    MemoryDecisionRecorderDeps,
    RecordDecisionInput,
} from "./decision/MemoryDecisionRecorder.js";

// ---------- Processing stage ----------
export { MemoryCandidateProcessor } from "./processing/MemoryCandidateProcessor.js";
export type { MemoryCandidateProcessorDeps } from "./processing/MemoryCandidateProcessor.js";
export type {
    MemoryCandidateProcessingOutcome,
    ProcessMemoryCandidatesInput,
    ProcessMemoryCandidatesResult,
} from "./processing/processingTypes.js";
