/**
 * Centralised log-event names for the memory pipeline.
 *
 * Stage code never inlines log message strings; it calls one of the
 * `MemoryPipelineLogger` methods which in turn references these
 * constants. The benefits are:
 *  - One audit point if you need to grep production logs for a
 *    specific stage event.
 *  - Renames go through TypeScript instead of through ad-hoc text
 *    edits scattered across stage files.
 *  - Tests can match on the symbolic name without relying on the
 *    exact string spelling.
 */
export const MEMORY_PIPELINE_LOG_EVENTS = {
    pipelineStarted: "memory.pipeline.started",
    pipelineSkipped: "memory.pipeline.skipped",
    pipelineCompleted: "memory.pipeline.completed",
    pipelineFailed: "memory.pipeline.failed",

    candidatesRecorded: "memory.pipeline.candidates_recorded",
    candidatesRecordingFailed: "memory.pipeline.candidates_recording_failed",
    candidateRecorderAllRejected: "memory.pipeline.candidates_all_rejected",

    candidateProcessingStarted: "memory.pipeline.candidate_started",
    candidateProcessingCompleted: "memory.pipeline.candidate_completed",
    candidateProcessingFailed: "memory.pipeline.candidate_failed",

    lowValueRejected: "memory.pipeline.low_value_rejected",
    exactDuplicateFound: "memory.pipeline.exact_duplicate_found",

    embeddingRequested: "memory.pipeline.embedding_requested",
    embeddingCompleted: "memory.pipeline.embedding_completed",
    embeddingFailed: "memory.pipeline.embedding_failed",

    activeMemoriesFetched: "memory.pipeline.active_memories_fetched",
    similarityRanked: "memory.pipeline.similarity_ranked",
    similaritySignatureMismatch: "memory.pipeline.similarity_signature_mismatch",
    retrievalEvidence: "memory.pipeline.retrieval_evidence",

    decisionMade: "memory.pipeline.decision_made",
    memoryCreated: "memory.pipeline.memory_created",
    memoryCreateFailed: "memory.pipeline.memory_create_failed",
    decisionRecorded: "memory.pipeline.decision_recorded",
} as const;

export type MemoryPipelineLogEvent =
    typeof MEMORY_PIPELINE_LOG_EVENTS[keyof typeof MEMORY_PIPELINE_LOG_EVENTS];
