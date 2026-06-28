import type { MemoryCandidateDraft } from "./candidate/candidateTypes.js";
import type { MemoryCandidateRecorder } from "./candidate/MemoryCandidateRecorder.js";
import type { MemoryPipelineLogger } from "./logging/MemoryPipelineLogger.js";
import type { MemoryPipelineSettings } from "./memoryPipelineSettings.js";
import type { MemoryCandidateSource } from "./memoryPipelineTypes.js";
import type { MemoryCandidateProcessor } from "./processing/MemoryCandidateProcessor.js";
import type {
    MemoryCandidateProcessingOutcome,
    ProcessMemoryCandidatesResult,
} from "./processing/processingTypes.js";

/**
 * Top-level entry point for the memory pipeline.
 *
 * Owns the two cross-stage policy switches:
 *  - `settings.enabled` — when `false`, every public method returns
 *    immediately. The chat turn service never has to ask "is the
 *    feature on?"; it just calls the service.
 *  - `settings.processingMode` — `"inline"` runs the processor
 *    synchronously after recording. `"record_only"` stops after the
 *    recorder, leaving candidates in `pending` for a later batch
 *    job. The processor itself does not know about this; the
 *    service mediates.
 *
 * Designed so a future async worker (Phase 5 of the refactor plan)
 * can call `processCandidates()` against the same processor instance
 * without touching the chat turn service.
 */
export interface HandleChatTurnCandidatesInput {
    source: MemoryCandidateSource;
    candidates: MemoryCandidateDraft[];
}

export interface HandleChatTurnCandidatesResult {
    recordedCount: number;
    processed?: ProcessMemoryCandidatesResult;
    /** Reason the pipeline did not run any work for this turn. */
    skippedReason?: "disabled" | "no_candidates";
}

export interface MemoryPipelineServiceDeps {
    candidateRecorder: MemoryCandidateRecorder;
    candidateProcessor: MemoryCandidateProcessor;
    pipelineLogger: MemoryPipelineLogger;
    settings: MemoryPipelineSettings;
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
            processingMode: settings.processingMode,
        });

        let recordedCount = 0;
        try {
            const recordResult = await this.deps.candidateRecorder.recordCandidates({
                source: input.source,
                candidates: input.candidates,
            });
            recordedCount = recordResult.accepted.length;
            logger.candidatesRecorded({
                ...baseFields,
                acceptedCount: recordResult.accepted.length,
                rejectedCount: recordResult.rejectedCount,
            });

            if (settings.processingMode === "record_only") {
                logger.pipelineCompleted({
                    ...baseFields,
                    recordedCount,
                    processedCount: 0,
                    processingMode: settings.processingMode,
                });
                return { recordedCount };
            }
            if (recordResult.accepted.length === 0) {
                logger.pipelineCompleted({
                    ...baseFields,
                    recordedCount,
                    processedCount: 0,
                    processingMode: settings.processingMode,
                });
                return { recordedCount };
            }

            const processed = await this.deps.candidateProcessor.processCandidates({
                candidates: recordResult.accepted,
            });
            logger.pipelineCompleted({
                ...baseFields,
                recordedCount,
                processedCount: processed.outcomes.length,
                processingMode: settings.processingMode,
            });
            return { recordedCount, processed };
        } catch (error) {
            // Recorder and processor both isolate their own per-candidate
            // failures, so this catch only fires on programmer bugs or
            // store outages that escaped internal handling. Fail-soft:
            // log, do not throw — the chat turn must never break because
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
     * Process already-recorded candidates. Used by the inline
     * pipeline and by future async workers (Phase 5). Returns the
     * outcomes verbatim from {@link MemoryCandidateProcessor}.
     */
    async processCandidates(input: {
        candidates: Parameters<MemoryCandidateProcessor["processCandidates"]>[0]["candidates"];
    }): Promise<ProcessMemoryCandidatesResult> {
        if (!this.deps.settings.enabled) {
            return { outcomes: [] };
        }
        return await this.deps.candidateProcessor.processCandidates({ candidates: input.candidates });
    }
}

// Re-export the per-candidate outcome so consumers that only depend
// on the service file don't have to chase the processing/ folder.
export type { MemoryCandidateProcessingOutcome };
