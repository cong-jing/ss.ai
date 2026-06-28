import type {
    MemoryCandidateRecord,
    MemoryCandidateStatus,
} from "../candidate/candidateTypes.js";
import type { MemoryCandidateStore } from "../candidate/candidatePorts.js";
import { checkExactDuplicate } from "../duplicate/exactDuplicateStep.js";
import type { MemoryEmbeddingStep } from "../embedding/MemoryEmbeddingStep.js";
import { MemoryPipelineLogger } from "../logging/MemoryPipelineLogger.js";
import type { MemorySettings } from "../settings.js";
import type {
    MemoryClock,
    MemoryLogger,
} from "../types.js";
import { MemoryDecisionRecorder } from "../decision/MemoryDecisionRecorder.js";
import type {
    MemoryDecisionKind,
    MemoryDecisionStore,
    MemorySimilaritySummaryEntry,
} from "../decision/decisionPorts.js";
import {
    decideBySimilarity,
    defaultMemoryDecisionPolicy,
    isLowValueCandidate,
    type MemoryDecisionPolicy,
} from "../decision/decisionPolicy.js";
import { rankSimilarMemories, type RankedMemory } from "../ranking/rankSimilarMemories.js";
import {
    signaturesMatch,
    totalSkipped,
    type EmbeddingSignature,
    type MemoryRankSkipBreakdown,
} from "../ranking/similarity.js";
import type {
    ActiveMemoryRecord,
    MemoryStore,
} from "../stores/activeMemoryStorePort.js";
import type {
    MemoryCandidateProcessingOutcome,
    ProcessMemoryCandidatesInput,
    ProcessMemoryCandidatesResult,
} from "./processingTypes.js";

/**
 * Default importance assigned to newly-created memories. Kept on
 * the processor rather than the policy so future per-scope/type
 * tuning lives in one place; today it is a single number while the
 * policy is still conservative.
 */
const DEFAULT_IMPORTANCE = 0.5;

export interface MemoryCandidateProcessorDeps {
    candidateStore: MemoryCandidateStore;
    memoryStore: MemoryStore;
    decisionStore: MemoryDecisionStore;
    embeddingStep: MemoryEmbeddingStep;
    decisionRecorder: MemoryDecisionRecorder;
    clock: MemoryClock;
    pipelineLogger: MemoryPipelineLogger;
    settings: MemorySettings;
    /**
     * Default importance assigned to newly-created memories. Falls
     * back to a fixed constant; never null/undefined inside the
     * processor itself.
     */
    defaultImportance?: number;
    /**
     * Override the decision policy. Defaults to
     * {@link defaultMemoryDecisionPolicy} with thresholds taken
     * from `settings.ranking`.
     */
    policy?: MemoryDecisionPolicy;
}

/**
 * Drives a candidate through:
 *   low-value filter -> exact-duplicate lookup -> embedding ->
 *   active-memory scan -> ranking -> decision -> memory create
 *   (if needed) -> decision row + candidate status update.
 *
 * Hard requirements:
 *  - Per-candidate isolation: a thrown error in one candidate must
 *    not abort the candidate list. Each candidate ends in either a recorded
 *    decision or a recorded error outcome.
 *  - Embedding signatures gate similarity: a memory whose stored
 *    embedding has a different provider/model/dim/version is
 *    skipped, not silently compared in the wrong latent space.
 *  - Conservative duplicates: exact normalized-text matches go to
 *    `ignore_duplicate` (text-level certainty), but near-duplicates
 *    above `exactDuplicateThreshold` go to `needs_judge` per the
 *    conservative policy.
 *  - Embedding failures degrade to `embedding_failed`, never throw.
 */
export class MemoryCandidateProcessor {
    private readonly policy: MemoryDecisionPolicy;
    private readonly listLimit: number;
    private readonly defaultImportance: number;

    constructor(private readonly deps: MemoryCandidateProcessorDeps) {
        const ranking = deps.settings.ranking;
        this.policy = deps.policy ?? {
            ...defaultMemoryDecisionPolicy,
            exactDuplicateThreshold: ranking.exactDuplicateThreshold,
            needsJudgeThreshold: ranking.needsJudgeThreshold,
            topK: ranking.topK,
        };
        this.listLimit = ranking.listLimit;
        this.defaultImportance = deps.defaultImportance ?? DEFAULT_IMPORTANCE;
    }

    async processCandidates(input: ProcessMemoryCandidatesInput): Promise<ProcessMemoryCandidatesResult> {
        const outcomes: MemoryCandidateProcessingOutcome[] = [];
        for (const candidate of input.candidates) {
            outcomes.push(await this.processOne(candidate));
        }
        return { outcomes };
    }

    private async processOne(candidate: MemoryCandidateRecord): Promise<MemoryCandidateProcessingOutcome> {
        const logger = this.deps.pipelineLogger;
        logger.candidateProcessingStarted({
            candidateId: candidate.id,
            requestId: candidate.source.requestId,
            scope: candidate.scope,
            type: candidate.type,
            ...(logger.includeCandidateText ? { text: candidate.text } : {}),
        });

        try {
            // 1. Low-value filter: avoid paying for an embedding on
            //    text we would never accept anyway.
            const lowValue = isLowValueCandidate(candidate);
            if (lowValue.lowValue) {
                logger.lowValueRejected({
                    candidateId: candidate.id,
                    reason: lowValue.reason ?? "low_value",
                });
                return await this.finalize({
                    candidate,
                    decision: "ignore_low_value",
                    candidateStatus: "ignored_low_value",
                    reason: lowValue.reason,
                });
            }

            // 2. Exact normalized-text duplicate check. Trust text
            //    equality more than embedding similarity at the top
            //    so we can short-circuit before paying for an
            //    embedding call.
            const exactDuplicate = await checkExactDuplicate(
                candidate,
                this.deps.memoryStore,
                logger,
            );
            if (exactDuplicate) {
                return await this.finalize({
                    candidate,
                    decision: "ignore_duplicate",
                    candidateStatus: "ignored_duplicate",
                    memoryId: exactDuplicate.id,
                    reason: "exact_normalized_text",
                    similarity: [{
                        memoryId: exactDuplicate.id,
                        similarity: 1,
                        text: exactDuplicate.text,
                    }],
                });
            }

            // 3. Embed.
            const embedOutcome = await this.deps.embeddingStep.embed(candidate);
            if (!embedOutcome.ok) {
                return await this.finalize({
                    candidate,
                    decision: "embedding_failed",
                    candidateStatus: "embedding_failed",
                    reason: embedOutcome.error.message,
                });
            }
            const embedded = embedOutcome.result.embedding;

            await this.deps.candidateStore.saveCandidateEmbedding({
                candidateId: candidate.id,
                embedding: embedded,
                updatedAt: this.deps.clock.nowIso(),
            });

            // 4. Fetch existing memories in the same logical bucket
            //    and rank them. Signature filtering protects from
            //    comparing across embedding model changes.
            const signature: EmbeddingSignature = {
                provider: embedded.provider,
                model: embedded.model,
                dim: embedded.dim,
                version: embedded.version,
            };
            const activeMemories = await this.deps.memoryStore.listActiveMemories({
                userId: candidate.source.userId,
                characterId: candidate.source.characterId,
                scope: candidate.scope,
                type: candidate.type,
                status: "active",
                limit: this.listLimit,
            });
            logger.activeMemoriesFetched({
                candidateId: candidate.id,
                scannedCount: activeMemories.length,
            });

            const { ranked, skipped } = this.rankWithSkipDiagnostics(
                embedded.vector,
                activeMemories,
                signature,
                candidate.id,
            );
            logger.similarityRanked({
                candidateId: candidate.id,
                rankedCount: ranked.length,
                topSimilarity: ranked[0]?.similarity,
                skipped,
                totalSkipped: totalSkipped(skipped),
            });

            // 5. Decide.
            const decision = decideBySimilarity(ranked, this.policy);
            logger.decisionMade({
                candidateId: candidate.id,
                decision: decision.kind,
                reason: decision.reason,
                topSimilarity: decision.topSimilarity,
            });

            const similaritySummary = this.toSummary(ranked);

            if (decision.kind === "needs_judge") {
                return await this.finalize({
                    candidate,
                    decision: "needs_judge",
                    candidateStatus: "needs_judge",
                    reason: decision.reason,
                    similarity: similaritySummary,
                    topSimilarity: decision.topSimilarity,
                    scannedCount: activeMemories.length,
                    skipped,
                });
            }

            // decision.kind === "create"
            const now = this.deps.clock.nowIso();
            let newMemory: ActiveMemoryRecord;
            try {
                newMemory = await this.deps.memoryStore.createMemory({
                    userId: candidate.source.userId,
                    characterId: candidate.source.characterId,
                    scope: candidate.scope,
                    type: candidate.type,
                    text: candidate.text,
                    normalizedText: candidate.normalizedText,
                    relatedEntities: candidate.relatedEntities,
                    tags: candidate.tags,
                    importance: this.defaultImportance,
                    sourceCandidateId: candidate.id,
                    sourceConversationId: candidate.source.conversationId,
                    sourceUserMessageId: candidate.source.userMessageId,
                    sourceAssistantMessageId: candidate.source.assistantMessageId,
                    embedding: embedded,
                    createdAt: now,
                    updatedAt: now,
                });
            } catch (error) {
                const err = error instanceof Error ? error : new Error(String(error));
                logger.memoryCreateFailed({ candidateId: candidate.id, error: err.message });
                return await this.finalize({
                    candidate,
                    decision: "error",
                    candidateStatus: "commit_failed",
                    reason: err.message,
                    similarity: similaritySummary,
                    topSimilarity: decision.topSimilarity,
                    scannedCount: activeMemories.length,
                    skipped,
                    error: err,
                });
            }

            logger.memoryCreated({ candidateId: candidate.id, memoryId: newMemory.id });

            return await this.finalize({
                candidate,
                decision: "create",
                candidateStatus: "committed",
                memoryId: newMemory.id,
                reason: decision.reason,
                similarity: similaritySummary,
                topSimilarity: decision.topSimilarity,
                scannedCount: activeMemories.length,
                skipped,
            });
        } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            logger.candidateProcessingFailed({
                candidateId: candidate.id,
                error: err.message,
            });
            // Best-effort: try to record an error decision so the
            // candidate row has a paper trail. Swallow any secondary
            // failure to honour the "no throw" contract.
            try {
                await this.finalize({
                    candidate,
                    decision: "error",
                    candidateStatus: "commit_failed",
                    reason: err.message,
                    error: err,
                });
            } catch {
                /* intentionally suppressed: see above */
            }
            return {
                candidateId: candidate.id,
                decision: "error",
                reason: err.message,
                error: err,
            };
        }
    }

    /**
     * Two responsibilities:
     *  - emit one `similaritySignatureMismatch` debug event per
     *    mismatched memory, so operators can see which specific
     *    rows were ignored (the breakdown only carries counts);
     *  - call {@link rankSimilarMemories}, which owns the canonical
     *    skip-counting logic and returns a structured breakdown
     *    with one cell per reason.
     */
    private rankWithSkipDiagnostics(
        candidateVector: number[],
        memories: ActiveMemoryRecord[],
        signature: EmbeddingSignature,
        candidateId: string,
    ): { ranked: RankedMemory[]; skipped: MemoryRankSkipBreakdown } {
        const logger = this.deps.pipelineLogger;
        for (const memory of memories) {
            const embedding = memory.embedding;
            if (!embedding) continue;
            if (signaturesMatch(embedding, signature)) continue;
            logger.similaritySignatureMismatch({
                candidateId,
                memoryId: memory.id,
                memorySignature: {
                    provider: embedding.provider,
                    model: embedding.model,
                    dim: embedding.dim,
                    version: embedding.version,
                },
            });
        }
        return rankSimilarMemories(candidateVector, memories, {
            topK: this.policy.topK,
            requireSignature: signature,
        });
    }

    private toSummary(ranked: RankedMemory[]): MemorySimilaritySummaryEntry[] {
        return ranked.map((entry) => ({
            memoryId: entry.memory.id,
            similarity: entry.similarity,
            text: entry.memory.text,
        }));
    }

    /**
     * Persist the candidate-status transition + decision row via
     * {@link MemoryDecisionRecorder} and build the
     * {@link MemoryCandidateProcessingOutcome} the caller can hand
     * directly to the result list.
     */
    private async finalize(args: {
        candidate: MemoryCandidateRecord;
        decision: MemoryDecisionKind;
        candidateStatus: MemoryCandidateStatus;
        memoryId?: string;
        reason?: string;
        similarity?: MemorySimilaritySummaryEntry[];
        topSimilarity?: number;
        scannedCount?: number;
        skipped?: MemoryRankSkipBreakdown;
        error?: Error;
    }): Promise<MemoryCandidateProcessingOutcome> {
        const decisionRecord = await this.deps.decisionRecorder.record({
            candidate: args.candidate,
            decision: args.decision,
            candidateStatus: args.candidateStatus,
            memoryId: args.memoryId,
            reason: args.reason,
            similarity: args.similarity,
            policyVersion: this.policy.policyVersion,
        });

        this.deps.pipelineLogger.decisionRecorded({
            candidateId: args.candidate.id,
            decision: decisionRecord.decision,
            decisionId: decisionRecord.id,
        });

        this.deps.pipelineLogger.candidateProcessingCompleted({
            candidateId: args.candidate.id,
            decision: decisionRecord.decision,
            ...(args.memoryId !== undefined ? { memoryId: args.memoryId } : {}),
            ...(args.topSimilarity !== undefined ? { topSimilarity: args.topSimilarity } : {}),
        });

        return {
            candidateId: args.candidate.id,
            decision: decisionRecord.decision,
            memoryId: args.memoryId,
            reason: args.reason,
            ...(args.topSimilarity !== undefined ? { topSimilarity: args.topSimilarity } : {}),
            ...(args.scannedCount !== undefined ? { scannedCount: args.scannedCount } : {}),
            ...(args.skipped !== undefined ? { skipped: { ...args.skipped } } : {}),
            ...(args.error ? { error: args.error } : {}),
        };
    }
}

// Compile-time discharge of MemoryLogger import (so the export is
// visible to typedoc consumers without unused-import warnings even
// when only the type is referenced via dependent files).
export type { MemoryLogger };
