import type { MemoryCandidateDraft } from "./candidate/candidateTypes.js";
import type { MemoryCandidateRecorder } from "./candidate/MemoryCandidateRecorder.js";
import type { MemoryPipelineLogger } from "./logging/MemoryPipelineLogger.js";
import type { MemorySettings } from "./settings.js";
import type { MemoryCandidateSource } from "./types.js";
import type {
    MemoryStagingProcessor,
    MemoryStagingProcessingOutcome,
    ProcessCandidatesResult,
    ProcessPendingCandidatesInput,
    ProcessPendingCandidatesResult,
} from "./staging/MemoryStagingProcessor.js";

/**
 * Top-level entry point for the memory pipeline.
 *
 * Owns the two cross-stage policy switches:
 *  - `settings.enabled`: when `false`, every public method returns
 *    immediately. The chat turn service never has to ask "is the
 *    feature on?"; it just calls the service.
 *  - `settings.candidateProcessingMode`: `"inline"` runs the
 *    staging processor synchronously after intake. `"record_only"`
 *    stops after the recorder, leaving candidates in `pending` for
 *    a later worker. The processor itself does not know about
 *    this; the service mediates.
 *
 * Designed so a future async worker can call
 * `processPendingCandidates()` against the same processor instance
 * without touching the chat turn service.
 */
export interface HandleChatTurnCandidatesInput {
    source: MemoryCandidateSource;
    candidates: MemoryCandidateDraft[];
}

export interface HandleChatTurnCandidatesResult {
    recordedCount: number;
    processed?: ProcessCandidatesResult;
    /** Reason the pipeline did not run any work for this turn. */
    skippedReason?: "disabled" | "no_candidates";
}

export interface MemoryPipelineServiceDeps {
    candidateRecorder: MemoryCandidateRecorder;
    stagingProcessor: MemoryStagingProcessor;
    pipelineLogger: MemoryPipelineLogger;
    settings: MemorySettings;
}

export class MemoryPipelineService {
    constructor(private readonly deps: MemoryPipelineServiceDeps) { }

    async handleChatTurnCandidates(input: HandleChatTurnCandidatesInput): Promise<HandleChatTurnCandidatesResult> {
        const settings = this.deps.settings;
        const logger = this.deps.pipelineLogger;
        const baseFields = {
            requestId: input.source.requestId,
            userId: input.source.userId,
            characterId: input.source.characterId,
            conversationId: input.source.conversationId,
            assistantMessageId: input.source.assistantMessageId,
        };

        if (!settings.enabled) {
            logger.pipelineSkipped({
                ...baseFields,
                reason: "disabled",
                candidateCount: input.candidates.length,
            });
            return { recordedCount: 0, skippedReason: "disabled" };
        }
        if (input.candidates.length === 0) {
            logger.pipelineSkipped({
                ...baseFields,
                reason: "no_candidates",
                candidateCount: 0,
            });
            return { recordedCount: 0, skippedReason: "no_candidates" };
        }

        logger.pipelineStarted({
            ...baseFields,
            candidateCount: input.candidates.length,
            candidateProcessingMode: settings.candidateProcessingMode,
        });

        let recordedCount = 0;
        try {
            const recordResult = await this.deps.candidateRecorder.recordCandidates({
                source: input.source,
                candidates: input.candidates,
            });
            recordedCount = recordResult.accepted.length;
            // Recorder swallows store outages and reports them via
            // `storeError`. Surface that here instead of silently
            // logging `pipelineCompleted`, otherwise dashboards see
            // a clean turn while no candidate row was actually
            // written.
            if (recordResult.storeError) {
                const storeErr = recordResult.storeError instanceof Error
                    ? recordResult.storeError
                    : new Error(String(recordResult.storeError));
                logger.candidatesRecordingFailed({
                    ...baseFields,
                    error: storeErr.message,
                    attemptedCount: input.candidates.length,
                });
                logger.pipelineFailed({
                    ...baseFields,
                    error: storeErr.message,
                    stage: "record",
                });
                return { recordedCount: 0 };
            }
            logger.candidatesRecorded({
                ...baseFields,
                acceptedCount: recordResult.accepted.length,
                rejectedCount: recordResult.rejectedCount,
            });

            // Record-only mode and "no surviving candidates" branches
            // both end the pipeline early with the same shape.
            if (
                settings.candidateProcessingMode === "record_only"
                || !settings.staging.enabled
                || recordResult.accepted.length === 0
            ) {
                logger.pipelineCompleted({
                    ...baseFields,
                    recordedCount,
                    processedCount: 0,
                    candidateProcessingMode: settings.candidateProcessingMode,
                });
                return { recordedCount };
            }

            const processed = await this.deps.stagingProcessor.processCandidates({
                candidates: recordResult.accepted,
            });
            logger.pipelineCompleted({
                ...baseFields,
                recordedCount,
                processedCount: processed.outcomes.length,
                candidateProcessingMode: settings.candidateProcessingMode,
            });
            return { recordedCount, processed };
        } catch (error) {
            // Recorder and processor both isolate their own per-candidate
            // failures, so this catch only fires on programmer bugs or
            // store outages that escaped internal handling. Fail-soft:
            // log, do not throw: the chat turn must never break because
            // memory is down.
            const err = error instanceof Error ? error : new Error(String(error));
            logger.pipelineFailed({
                ...baseFields,
                error: err.message,
                stage: "outer",
            });
            return { recordedCount };
        }
    }

    /**
     * Process up to `limit` pending candidates for the given user +
     * character. Used by async workers and by future debug routes
     * that want to drain pending intake. Inline mode normally goes
     * through {@link handleChatTurnCandidates} instead.
     */
    async processPendingCandidates(input: ProcessPendingCandidatesInput): Promise<ProcessPendingCandidatesResult> {
        if (!this.deps.settings.enabled || !this.deps.settings.staging.enabled) {
            return { outcomes: [] };
        }
        return await this.deps.stagingProcessor.processPendingCandidates(input);
    }
}

// Re-export the per-candidate outcome so consumers that only depend
// on the service file don't have to chase the staging/ folder.
export type { MemoryStagingProcessingOutcome };
