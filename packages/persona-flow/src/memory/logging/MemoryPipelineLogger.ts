import type { MemoryLogger } from "../types.js";
import type { MemoryCandidateType, MemoryScope } from "@ss-ai/contracts";
import type { MemorySettings } from "../settings.js";
import { MEMORY_PIPELINE_LOG_EVENTS, type MemoryPipelineLogEvent } from "./memoryPipelineLogEvents.js";

/**
 * Stage-aware logger wrapper for the memory pipeline.
 *
 * Stage code calls one of the named methods (`pipelineStarted`,
 * `embeddingFailed`, etc.) instead of inlining log event strings. This
 * keeps the catalogue of events in `memoryPipelineLogEvents.ts` and
 * Debug events carry compact stage state. Verbose events carry the
 * heavier retrieval evidence used for threshold tuning. The global
 * logger level decides what actually reaches disk.
 *
 * The wrapper is intentionally thin and stateless; if the upstream
 * `MemoryLogger` is missing a `debug` method, debug events are
 * silently dropped (matching the behaviour of the previous direct
 * `logger.debug?.(...)` calls).
 */
export class MemoryPipelineLogger {
    constructor(private readonly logger: MemoryLogger | undefined) { }

    pipelineStarted(payload: PipelineStartedPayload): void {
        this.debug(MEMORY_PIPELINE_LOG_EVENTS.pipelineStarted, payload);
    }

    pipelineSkipped(payload: PipelineSkippedPayload): void {
        this.debug(MEMORY_PIPELINE_LOG_EVENTS.pipelineSkipped, payload);
    }

    pipelineCompleted(payload: PipelineCompletedPayload): void {
        this.debug(MEMORY_PIPELINE_LOG_EVENTS.pipelineCompleted, payload);
    }

    pipelineFailed(payload: PipelineFailedPayload): void {
        this.warn(MEMORY_PIPELINE_LOG_EVENTS.pipelineFailed, payload);
    }

    candidatesRecorded(payload: CandidatesRecordedPayload): void {
        this.debug(MEMORY_PIPELINE_LOG_EVENTS.candidatesRecorded, payload);
    }

    candidatesRecordingFailed(payload: CandidatesRecordingFailedPayload): void {
        this.warn(MEMORY_PIPELINE_LOG_EVENTS.candidatesRecordingFailed, payload);
    }

    candidateRecorderAllRejected(payload: CandidateRecorderAllRejectedPayload): void {
        this.debug(MEMORY_PIPELINE_LOG_EVENTS.candidateRecorderAllRejected, payload);
    }

    candidateProcessingStarted(payload: CandidateProcessingStartedPayload): void {
        this.debug(MEMORY_PIPELINE_LOG_EVENTS.candidateProcessingStarted, payload);
    }

    candidateProcessingCompleted(payload: CandidateProcessingCompletedPayload): void {
        this.debug(MEMORY_PIPELINE_LOG_EVENTS.candidateProcessingCompleted, payload);
    }

    candidateProcessingFailed(payload: CandidateProcessingFailedPayload): void {
        this.warn(MEMORY_PIPELINE_LOG_EVENTS.candidateProcessingFailed, payload);
    }

    lowValueRejected(payload: LowValueRejectedPayload): void {
        this.debug(MEMORY_PIPELINE_LOG_EVENTS.lowValueRejected, payload);
    }

    exactDuplicateFound(payload: ExactDuplicateFoundPayload): void {
        this.debug(MEMORY_PIPELINE_LOG_EVENTS.exactDuplicateFound, payload);
    }

    embeddingRequested(payload: EmbeddingRequestedPayload): void {
        this.debug(MEMORY_PIPELINE_LOG_EVENTS.embeddingRequested, payload);
    }

    embeddingCompleted(payload: EmbeddingCompletedPayload): void {
        this.debug(MEMORY_PIPELINE_LOG_EVENTS.embeddingCompleted, payload);
    }

    embeddingFailed(payload: EmbeddingFailedPayload): void {
        this.warn(MEMORY_PIPELINE_LOG_EVENTS.embeddingFailed, payload);
    }

    activeMemoriesFetched(payload: ActiveMemoriesFetchedPayload): void {
        this.debug(MEMORY_PIPELINE_LOG_EVENTS.activeMemoriesFetched, payload);
    }

    similarityRanked(payload: SimilarityRankedPayload): void {
        this.debug(MEMORY_PIPELINE_LOG_EVENTS.similarityRanked, payload);
    }

    similaritySignatureMismatch(payload: SimilaritySignatureMismatchPayload): void {
        this.debug(MEMORY_PIPELINE_LOG_EVENTS.similaritySignatureMismatch, payload);
    }

    retrievalEvidence(payload: RetrievalEvidencePayload): void {
        this.verbose(MEMORY_PIPELINE_LOG_EVENTS.retrievalEvidence, payload);
    }

    decisionMade(payload: DecisionMadePayload): void {
        this.debug(MEMORY_PIPELINE_LOG_EVENTS.decisionMade, payload);
    }

    memoryCreated(payload: MemoryCreatedPayload): void {
        this.debug(MEMORY_PIPELINE_LOG_EVENTS.memoryCreated, payload);
    }

    memoryCreateFailed(payload: MemoryCreateFailedPayload): void {
        this.warn(MEMORY_PIPELINE_LOG_EVENTS.memoryCreateFailed, payload);
    }

    decisionRecorded(payload: DecisionRecordedPayload): void {
        this.debug(MEMORY_PIPELINE_LOG_EVENTS.decisionRecorded, payload);
    }

    private debug(event: MemoryPipelineLogEvent, payload: unknown): void {
        this.logger?.debug?.(event, payload);
    }

    private verbose(event: MemoryPipelineLogEvent, payload: unknown): void {
        this.logger?.verbose?.(event, payload);
    }

    private warn(event: MemoryPipelineLogEvent, payload: unknown): void {
        this.logger?.warn(event, payload);
    }
}

// ---------- Payload shapes ----------
// These are kept loose on purpose: stage code can grow new fields
// without touching this file as long as common keys keep their meaning.

export interface PipelineBaseFields {
    requestId: string;
    userId: string;
    characterId: string;
    conversationId: string;
    assistantMessageId: string;
}

export interface PipelineStartedPayload extends PipelineBaseFields {
    candidateCount: number;
    candidateProcessingMode: MemorySettings["candidateProcessingMode"];
}

export interface PipelineSkippedPayload extends PipelineBaseFields {
    reason: "disabled" | "no_candidates";
    candidateCount: number;
}

export interface PipelineCompletedPayload extends PipelineBaseFields {
    recordedCount: number;
    processedCount: number;
    candidateProcessingMode: MemorySettings["candidateProcessingMode"];
}

export interface PipelineFailedPayload extends PipelineBaseFields {
    error: string;
    stage: "record" | "process" | "outer";
}

export interface CandidatesRecordedPayload extends PipelineBaseFields {
    acceptedCount: number;
    rejectedCount: number;
}

export interface CandidatesRecordingFailedPayload extends PipelineBaseFields {
    error: string;
    attemptedCount: number;
}

export interface CandidateRecorderAllRejectedPayload {
    requestId: string;
    rejectedCount: number;
}

export interface CandidateProcessingStartedPayload {
    candidateId: string;
    requestId: string;
    scope: string;
    type: string;
}

export interface CandidateProcessingCompletedPayload {
    candidateId: string;
    decision: string;
    memoryId?: string;
    topSimilarity?: number;
}

export interface CandidateProcessingFailedPayload {
    candidateId: string;
    error: string;
}

export interface LowValueRejectedPayload {
    candidateId: string;
    reason: string;
}

export interface ExactDuplicateFoundPayload {
    candidateId: string;
    memoryId: string;
    normalizedText?: string;
}

export interface EmbeddingRequestedPayload {
    candidateId: string;
}

export interface EmbeddingCompletedPayload {
    candidateId: string;
    provider: string;
    model: string;
    dim: number;
    version: number;
}

/**
 * Warning-level payload for `memory.pipeline.embedding_failed`.
 *
 * Carries enough context to triage "why did this turn lose memory
 * staging" without cross-referencing the candidate row: who the
 * user/character was, which scope/type the candidate fell into,
 * and the provider error message. The candidate row itself is
 * marked `failed/embedding_failed` so the log + the DB row
 * triangulate together.
 */
export interface EmbeddingFailedPayload {
    candidateId: string;
    userId: string;
    characterId: string;
    scope: MemoryScope;
    type: MemoryCandidateType;
    /** Provider error message, flattened to a string at the step boundary. */
    reason: string;
}

export interface ActiveMemoriesFetchedPayload {
    candidateId: string;
    scannedCount: number;
}

export interface SimilarityRankedPayload {
    candidateId: string;
    rankedCount: number;
    topSimilarity?: number;
    policy: {
        topK: number;
        needsJudgeThreshold: number;
        exactDuplicateThreshold: number;
        policyVersion: number;
    };
    skipped: {
        noEmbedding: number;
        signatureMismatch: number;
        corruptDim: number;
        nonFiniteSimilarity: number;
    };
    totalSkipped: number;
}

export interface SimilaritySignatureMismatchPayload {
    candidateId: string;
    memoryId: string;
    memorySignature: {
        provider: string;
        model: string;
        dim: number;
        version: number;
    };
}

export interface DecisionMadePayload {
    candidateId: string;
    decision: string;
    reason?: string;
    topSimilarity?: number;
    policy: {
        needsJudgeThreshold: number;
        exactDuplicateThreshold: number;
        policyVersion: number;
    };
}

export interface RetrievalEvidencePayload {
    candidate: {
        candidateId: string;
        scope: string;
        type: string;
        normalizedText: string;
        text: string;
        relatedEntities: string[];
        tags: string[];
    };
    bucket: {
        userId: string;
        characterId: string;
        scope: string;
        type: string;
        status: "active";
        listLimit: number;
    };
    candidateEmbedding: {
        provider: string;
        model: string;
        dim: number;
        version: number;
        vectorNorm: number;
    };
    policy: {
        topK: number;
        needsJudgeThreshold: number;
        exactDuplicateThreshold: number;
        policyVersion: number;
    };
    scan: {
        scannedCount: number;
        rankedCount: number;
        skipped: {
            noEmbedding: number;
            signatureMismatch: number;
            corruptDim: number;
            nonFiniteSimilarity: number;
        };
        totalSkipped: number;
    };
    topMatches: Array<{
        memoryId: string;
        similarity: number;
        normalizedText: string;
        text: string;
        importance: number;
        updatedAt: string;
        embedding?: {
            provider: string;
            model: string;
            dim: number;
            version: number;
        };
    }>;
    decision: {
        kind: string;
        reason?: string;
        topSimilarity?: number;
    };
}

export interface MemoryCreatedPayload {
    candidateId: string;
    memoryId: string;
}

export interface MemoryCreateFailedPayload {
    candidateId: string;
    error: string;
}

export interface DecisionRecordedPayload {
    candidateId: string;
    decision: string;
    decisionId: string;
}
