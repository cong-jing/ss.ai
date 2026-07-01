import type { MemoryCandidateRecord } from "../candidate/candidateTypes.js";
import type { MemoryCandidateStore } from "../candidate/candidatePorts.js";
import { normalizeMemoryText } from "../candidate/textNormalization.js";
import { isLowValueCandidate } from "../decision/decisionPolicy.js";
import type { MemoryEmbedding } from "../embedding/embeddingPorts.js";
import type { MemoryEmbeddingStep } from "../embedding/MemoryEmbeddingStep.js";
import { MemoryPipelineLogger } from "../logging/MemoryPipelineLogger.js";
import {
    cosineSimilarity,
    emptyMemoryRankSkipBreakdown,
    signaturesMatch,
    totalSkipped,
    type EmbeddingSignature,
} from "../ranking/similarity.js";
import type { MemorySettings } from "../settings.js";
import type { MemoryClock } from "../types.js";
import type {
    MemoryStagingRecord,
    MemoryStagingSourceRecord,
} from "./memoryStagingTypes.js";
import type { MemoryStagingStore } from "./memoryStagingPorts.js";

/**
 * Per-candidate outcome of a staging-processor run. Mirrors the
 * candidate status transition the processor made: callers (tests,
 * the pipeline service, future debug surfaces) can render a uniform
 * table of "what happened" without peeking at the candidate store.
 */
export interface MemoryStagingProcessingOutcome {
    candidateId: string;
    /** Final candidate status after this run. */
    candidateStatus: "processed" | "rejected_by_rule" | "failed";
    /** Free-form status reason persisted on the candidate row. */
    statusReason: string;
    /** Set when a staging row was created or matched. */
    stagingId?: string;
    /**
     * `"created"`: a new staging row was inserted.
     * `"duplicate"`: matched an existing staging row by normalized
     *    text; `occurrenceCount` was incremented and a new source
     *    link was added.
     * `"idempotent"`: a previous run had already linked this
     *    candidate to a staging row; no write happened in this run.
     * `"none"`: no staging row produced (candidate was rejected or
     *    failed before any staging write).
     */
    stagingOutcome: "created" | "duplicate" | "idempotent" | "none";
    /** Top similarity to the nearest existing staging row, when sampled. */
    topSimilarity?: number;
    /** Set on the `failed` branch. Never surfaces as a thrown error. */
    error?: Error;
}

export interface ProcessPendingCandidatesInput {
    userId: string;
    characterId: string;
    /** Falls back to `settings.staging.candidateBatchLimit`. */
    limit?: number;
}

export interface ProcessPendingCandidatesResult {
    outcomes: MemoryStagingProcessingOutcome[];
}

export interface ProcessCandidatesInput {
    candidates: MemoryCandidateRecord[];
}

export interface ProcessCandidatesResult {
    outcomes: MemoryStagingProcessingOutcome[];
}

export interface MemoryStagingProcessorDeps {
    candidateStore: MemoryCandidateStore;
    stagingStore: MemoryStagingStore;
    embeddingStep: MemoryEmbeddingStep;
    clock: MemoryClock;
    pipelineLogger: MemoryPipelineLogger;
    settings: MemorySettings;
}

/**
 * Drives one or more candidates through:
 *   idempotency check (findBySourceCandidate) -> low-value filter ->
 *   embed -> staging exact-dup aggregate (normalizedText) ->
 *   create staging row (or increment occurrence + link source) ->
 *   transition the candidate row to its terminal status.
 *
 * Hard requirements:
 *  - Per-candidate isolation: a thrown error in one candidate must
 *    not abort the batch. Each candidate ends in either a recorded
 *    status transition or a recorded error outcome.
 *  - Idempotent retries: a candidate already linked to a staging
 *    row in a previous run is recognised via
 *    `findBySourceCandidate` and short-circuits to
 *    `stagingOutcome: "idempotent"` without double counting.
 *  - Embedding failures degrade to candidate `failed` /
 *    statusReason `embedding_failed`. The staging row is NOT
 *    created — Batch 3.5 never persists staging rows without an
 *    embedding so downstream similarity / consolidation can assume
 *    every row carries one.
 *  - Similarity sampling is verbose-log-only in Batch 3.5: it never
 *    affects which staging row a candidate aggregates into.
 */
export class MemoryStagingProcessor {
    constructor(private readonly deps: MemoryStagingProcessorDeps) { }

    /**
     * Process a previously-recorded list of candidate rows.
     * Convenience used by the inline pipeline path: the chat turn
     * service hands the freshly-intaken rows here directly so we
     * skip the extra `listPendingCandidates` round-trip.
     */
    async processCandidates(input: ProcessCandidatesInput): Promise<ProcessCandidatesResult> {
        const outcomes: MemoryStagingProcessingOutcome[] = [];
        for (const candidate of input.candidates) {
            outcomes.push(await this.processOne(candidate));
        }
        return { outcomes };
    }

    /**
     * Process up to `limit` pending candidates for the given
     * (userId, characterId) pair. Used by future async workers and
     * the debug "drain pending" button. Inline mode prefers
     * {@link processCandidates} but can call this too.
     */
    async processPendingCandidates(input: ProcessPendingCandidatesInput): Promise<ProcessPendingCandidatesResult> {
        const limit = input.limit ?? this.deps.settings.staging.candidateBatchLimit;
        const pending = await this.deps.candidateStore.listPendingCandidates({
            userId: input.userId,
            characterId: input.characterId,
            limit,
        });
        return this.processCandidates({ candidates: pending });
    }

    private async processOne(candidate: MemoryCandidateRecord): Promise<MemoryStagingProcessingOutcome> {
        const logger = this.deps.pipelineLogger;
        logger.candidateProcessingStarted({
            candidateId: candidate.id,
            requestId: candidate.source.requestId,
            scope: candidate.scope,
            type: candidate.type,
        });

        try {
            // 0. Idempotency: if a previous run already linked this
            //    candidate to a staging row, we're done. Honours
            //    "no double counting on retry" AND repairs the
            //    candidate row's status: a previous run may have
            //    written the staging row but failed to flip the
            //    candidate to `processed`. Without going through
            //    `finalize(...)` the candidate would stay `pending`
            //    forever and `processPendingCandidates` would keep
            //    re-scanning it.
            const existingLink = await this.deps.stagingStore.findBySourceCandidate({
                candidateId: candidate.id,
            });
            if (existingLink) {
                return await this.finalize({
                    candidate,
                    status: "processed",
                    statusReason: "idempotent_already_linked",
                    stagingId: existingLink.id,
                    stagingOutcome: "idempotent",
                });
            }

            // 1. Low-value filter — cheap and avoids paying for an
            //    embedding on text we would never stage.
            const lowValue = isLowValueCandidate(candidate);
            if (lowValue.lowValue) {
                const reason = lowValue.reason ?? "low_value";
                logger.lowValueRejected({
                    candidateId: candidate.id,
                    reason,
                });
                return await this.finalize({
                    candidate,
                    status: "rejected_by_rule",
                    statusReason: reason,
                    stagingOutcome: "none",
                });
            }

            const normalizedText = normalizeMemoryText(candidate.text);

            // 2. Embed. Batch 3.5: failure always terminates the
            //    candidate with `failed/embedding_failed`; we never
            //    persist a staging row without an embedding.
            const embedOutcome = await this.deps.embeddingStep.embed(candidate);
            if (!embedOutcome.ok) {
                return await this.finalize({
                    candidate,
                    status: "failed",
                    statusReason: "embedding_failed",
                    stagingOutcome: "none",
                    error: embedOutcome.error,
                });
            }
            const embedded = embedOutcome.result.embedding;

            // 3. Exact normalized-text aggregation against staging.
            //    Disabled in settings -> always create a new row.
            const exactMatch = this.deps.settings.staging.duplicate.normalizedText
                ? await this.deps.stagingStore.findExact({
                    userId: candidate.source.userId,
                    characterId: candidate.source.characterId,
                    scope: candidate.scope,
                    type: candidate.type,
                    normalizedText,
                })
                : undefined;

            // 4. Verbose similarity sampling. Never influences the
            //    aggregation decision in Batch 3.5; surfaces near-
            //    duplicates so operators can tune later batches.
            let topSimilarity: number | undefined;
            if (embedded && this.deps.settings.staging.similaritySampling.enabled) {
                topSimilarity = await this.sampleSimilarity(candidate, embedded);
            }

            const now = this.deps.clock.nowIso();
            if (exactMatch) {
                // Duplicate path: link + increment.
                try {
                    await this.deps.stagingStore.linkSource({
                        memoryStagingId: exactMatch.id,
                        candidateId: candidate.id,
                        candidateSeq: candidate.seq,
                        createdAt: now,
                    });
                    await this.deps.stagingStore.incrementOccurrence({
                        memoryStagingId: exactMatch.id,
                        lastSeenAt: now,
                        updatedAt: now,
                    });
                } catch (err) {
                    const error = err instanceof Error ? err : new Error(String(err));
                    logger.candidateProcessingFailed({
                        candidateId: candidate.id,
                        error: error.message,
                    });
                    return await this.finalize({
                        candidate,
                        status: "failed",
                        statusReason: "staging_link_failed",
                        stagingOutcome: "none",
                        error,
                    });
                }
                logger.exactDuplicateFound({
                    candidateId: candidate.id,
                    memoryId: exactMatch.id,
                    normalizedText,
                });
                return await this.finalize({
                    candidate,
                    status: "processed",
                    statusReason: "staging_duplicate_normalized_text",
                    stagingId: exactMatch.id,
                    stagingOutcome: "duplicate",
                    topSimilarity,
                });
            }

            // 5. New staging row.
            let created: MemoryStagingRecord;
            try {
                created = await this.deps.stagingStore.create({
                    userId: candidate.source.userId,
                    characterId: candidate.source.characterId,
                    scope: candidate.scope,
                    type: candidate.type,
                    text: candidate.text,
                    normalizedText,
                    relatedEntities: [...candidate.relatedEntities],
                    tags: [...candidate.tags],
                    status: "pending",
                    statusReason: "created_from_candidate",
                    firstSeenAt: candidate.createdAt,
                    now,
                    ...(embedded ? { embedding: embedded } : {}),
                    initialSource: {
                        candidateId: candidate.id,
                        candidateSeq: candidate.seq,
                    },
                });
            } catch (err) {
                const error = err instanceof Error ? err : new Error(String(err));
                logger.candidateProcessingFailed({
                    candidateId: candidate.id,
                    error: error.message,
                });
                return await this.finalize({
                    candidate,
                    status: "failed",
                    statusReason: "staging_create_failed",
                    stagingOutcome: "none",
                    error,
                });
            }

            logger.memoryCreated({ candidateId: candidate.id, memoryId: created.id });
            return await this.finalize({
                candidate,
                status: "processed",
                statusReason: "staging_created",
                stagingId: created.id,
                stagingOutcome: "created",
                topSimilarity,
            });
        } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            logger.candidateProcessingFailed({
                candidateId: candidate.id,
                error: err.message,
            });
            // Best-effort terminal status update; swallow secondary
            // failures so this method honours the "no throw" contract.
            try {
                await this.finalize({
                    candidate,
                    status: "failed",
                    statusReason: "unexpected_error",
                    stagingOutcome: "none",
                    error: err,
                });
            } catch {
                /* intentionally suppressed: see above */
            }
            return {
                candidateId: candidate.id,
                candidateStatus: "failed",
                statusReason: "unexpected_error",
                stagingOutcome: "none",
                error: err,
            };
        }
    }

    /**
     * Verbose-log-only similarity probe. Pulls the same logical
     * bucket the duplicate aggregation step uses and scores the
     * candidate vector against existing staging embeddings. Returns
     * the top similarity (when any) so the per-candidate outcome
     * can surface it; emits a structured `similarityRanked` debug
     * event with the breakdown.
     *
     * Inlines the cosine + skip bookkeeping rather than reusing
     * `rankSimilarMemories` so the staging stage does not need to
     * adapt its records to the retained-memory ranker shape.
     */
    private async sampleSimilarity(
        candidate: MemoryCandidateRecord,
        embedded: MemoryEmbedding,
    ): Promise<number | undefined> {
        const sampling = this.deps.settings.staging.similaritySampling;
        const logger = this.deps.pipelineLogger;
        const signature: EmbeddingSignature = {
            provider: embedded.provider,
            model: embedded.model,
            dim: embedded.dim,
            version: embedded.version,
        };
        const stagingRows = await this.deps.stagingStore.list({
            userId: candidate.source.userId,
            characterId: candidate.source.characterId,
            scope: candidate.scope,
            type: candidate.type,
            status: "pending",
            limit: sampling.listLimit,
        });

        const skipped = emptyMemoryRankSkipBreakdown();
        const scored: Array<{ id: string; similarity: number }> = [];
        for (const row of stagingRows) {
            const rowEmbedding = row.embedding;
            if (!rowEmbedding) {
                skipped.noEmbedding += 1;
                continue;
            }
            if (!signaturesMatch(rowEmbedding, signature)) {
                logger.similaritySignatureMismatch({
                    candidateId: candidate.id,
                    memoryId: row.id,
                    memorySignature: {
                        provider: rowEmbedding.provider,
                        model: rowEmbedding.model,
                        dim: rowEmbedding.dim,
                        version: rowEmbedding.version,
                    },
                });
                skipped.signatureMismatch += 1;
                continue;
            }
            if (rowEmbedding.vector.length !== rowEmbedding.dim) {
                skipped.corruptDim += 1;
                continue;
            }
            const similarity = cosineSimilarity(embedded.vector, rowEmbedding.vector);
            if (!Number.isFinite(similarity)) {
                skipped.nonFiniteSimilarity += 1;
                continue;
            }
            scored.push({ id: row.id, similarity });
        }
        scored.sort((a, b) => b.similarity - a.similarity);
        const ranked = scored.length <= sampling.topK ? scored : scored.slice(0, sampling.topK);
        logger.similarityRanked({
            candidateId: candidate.id,
            rankedCount: ranked.length,
            topSimilarity: ranked[0]?.similarity,
            policy: {
                topK: sampling.topK,
                needsJudgeThreshold: 0,
                exactDuplicateThreshold: 0,
                policyVersion: 0,
            },
            skipped,
            totalSkipped: totalSkipped(skipped),
        });
        return ranked[0]?.similarity;
    }

    private async finalize(args: {
        candidate: MemoryCandidateRecord;
        status: "processed" | "rejected_by_rule" | "failed";
        statusReason: string;
        stagingId?: string;
        stagingOutcome: MemoryStagingProcessingOutcome["stagingOutcome"];
        topSimilarity?: number;
        error?: Error;
    }): Promise<MemoryStagingProcessingOutcome> {
        const now = this.deps.clock.nowIso();
        await this.deps.candidateStore.updateCandidateStatus({
            candidateId: args.candidate.id,
            status: args.status,
            statusReason: args.statusReason,
            updatedAt: now,
        });
        this.deps.pipelineLogger.candidateProcessingCompleted({
            candidateId: args.candidate.id,
            decision: args.status,
            ...(args.stagingId !== undefined ? { memoryId: args.stagingId } : {}),
            ...(args.topSimilarity !== undefined ? { topSimilarity: args.topSimilarity } : {}),
        });
        return {
            candidateId: args.candidate.id,
            candidateStatus: args.status,
            statusReason: args.statusReason,
            ...(args.stagingId !== undefined ? { stagingId: args.stagingId } : {}),
            stagingOutcome: args.stagingOutcome,
            ...(args.topSimilarity !== undefined ? { topSimilarity: args.topSimilarity } : {}),
            ...(args.error ? { error: args.error } : {}),
        };
    }
}

// Keep the unused-yet-public re-export so adapters can import the
// link record type from this single staging entry point.
export type { MemoryStagingRecord, MemoryStagingSourceRecord };
