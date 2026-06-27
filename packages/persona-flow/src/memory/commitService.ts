import type {
    ActiveMemoryRecord,
    MemoryCandidateRecord,
    MemoryDecisionKind,
    MemoryDecisionRecord,
    MemoryEmbedding,
    MemorySimilaritySummaryEntry,
} from "./types.js";
import { MEMORY_SCHEMA_VERSION } from "./types.js";
import type {
    MemoryCandidateStore,
    MemoryClock,
    MemoryDecisionStore,
    MemoryEmbeddingProvider,
    MemoryIdGenerator,
    MemoryLogger,
    MemoryStore,
} from "./ports.js";
import type { EmbeddingSignature, MemoryRankSkipBreakdown, RankedMemory } from "./similarity.js";
import { rankSimilarMemories, signaturesMatch, totalSkipped } from "./similarity.js";
import {
    decideBySimilarity,
    defaultMemoryDecisionPolicy,
    isLowValueCandidate,
    type MemoryDecisionPolicy,
} from "./decisionPolicy.js";

/**
 * Per-candidate outcome of {@link MemoryCommitService.commitCandidates}.
 *
 * Returned even for non-`create` decisions so callers (debug API,
 * tests) can render a uniform table of "what happened" without
 * peeking at internal stores.
 */
export interface MemoryCommitOutcome {
    candidateId: string;
    decision: MemoryDecisionKind;
    /** Set only when `decision === "create"`. */
    memoryId?: string;
    reason?: string;
    /** Cosine similarity of the top-ranked existing memory, when computed. */
    topSimilarity?: number;
    /**
     * Total number of active memories fetched from the store for
     * this candidate's bucket (before any skip filtering). Useful
     * as the denominator for `skipped`.
     */
    scannedCount?: number;
    /**
     * Per-reason tally of memories that were inspected but excluded
     * from the ranking. See {@link MemoryRankSkipBreakdown} for the
     * meaning of each field. Set whenever a similarity scan ran
     * (i.e. not for low-value / exact-duplicate / embedding-failed
     * branches that short-circuited before scanning).
     */
    skipped?: MemoryRankSkipBreakdown;
    /** Set when the per-candidate pipeline threw; never surfaces as a thrown error. */
    error?: Error;
}

export interface CommitMemoryCandidatesInput {
    candidates: MemoryCandidateRecord[];
}

export interface CommitMemoryCandidatesResult {
    outcomes: MemoryCommitOutcome[];
}

interface MemoryCommitServiceDeps {
    candidateStore: MemoryCandidateStore;
    memoryStore: MemoryStore;
    decisionStore: MemoryDecisionStore;
    embeddingProvider: MemoryEmbeddingProvider;
    clock: MemoryClock;
    ids: MemoryIdGenerator;
    logger?: MemoryLogger;
    /**
     * Default importance assigned to newly-created memories. Kept on
     * the service rather than the policy so future per-scope/type
     * tuning lives in one place; today it is a single number to keep
     * Batch 2/3 minimal.
     */
    defaultImportance?: number;
}

export interface MemoryCommitServiceOptions {
    /** Override the default policy (thresholds + topK + policyVersion). */
    policy?: MemoryDecisionPolicy;
    /**
     * Hard cap on the brute-force similarity scan. Defaults to a
     * generous value so the recorder never silently truncates;
     * production wiring may lower it once the dataset grows.
     */
    listLimit?: number;
}

/**
 * Stage names used in verbose logger output. Centralized as a const
 * so test suites can match on the string literals (and a typo in
 * the logger call surfaces as a TS error rather than a silent miss).
 */
const STAGE = {
    received: "memory.commit.candidate_received",
    low_value: "memory.commit.ignore_low_value",
    duplicate: "memory.commit.ignore_duplicate",
    embedding_requested: "memory.commit.embedding_requested",
    embedding_failed: "memory.commit.embedding_failed",
    similarity_scan_finished: "memory.commit.similarity_scan_finished",
    decision_made: "memory.commit.decision_made",
    create_failed: "memory.commit.create_failed",
    skipped_signature_mismatch: "memory.commit.skipped_signature_mismatch",
} as const;

const DEFAULT_LIST_LIMIT = 500;
const DEFAULT_IMPORTANCE = 0.5;

/**
 * Drives a candidate through the embedding → similarity → decision
 * pipeline and persists the outcome.
 *
 * Hard requirements:
 *  - Per-candidate isolation: a thrown error in one candidate must
 *    not abort the batch. Each candidate ends in either a recorded
 *    decision or a recorded error outcome.
 *  - Embedding signatures gate similarity: a memory whose stored
 *    embedding has a different provider/model/dim/version is
 *    skipped, not silently compared in the wrong latent space.
 *  - Conservative duplicates: exact normalized-text matches go to
 *    `ignore_duplicate` (text-level certainty), but near-duplicates
 *    above `exactDuplicateThreshold` go to `needs_judge` per the
 *    Batch 2/3 policy.
 *  - Embedding failures degrade to `embedding_failed`, never throw.
 */
export class MemoryCommitService {
    private readonly deps: MemoryCommitServiceDeps;
    private readonly policy: MemoryDecisionPolicy;
    private readonly listLimit: number;

    constructor(deps: MemoryCommitServiceDeps, options: MemoryCommitServiceOptions = {}) {
        this.deps = deps;
        this.policy = options.policy ?? defaultMemoryDecisionPolicy;
        this.listLimit = options.listLimit ?? DEFAULT_LIST_LIMIT;
    }

    async commitCandidates(input: CommitMemoryCandidatesInput): Promise<CommitMemoryCandidatesResult> {
        const outcomes: MemoryCommitOutcome[] = [];
        for (const candidate of input.candidates) {
            outcomes.push(await this.commitOne(candidate));
        }
        return { outcomes };
    }

    private async commitOne(candidate: MemoryCandidateRecord): Promise<MemoryCommitOutcome> {
        this.deps.logger?.debug?.(STAGE.received, {
            candidateId: candidate.id,
            requestId: candidate.source.requestId,
            scope: candidate.scope,
            type: candidate.type,
        });

        try {
            // 1. Cheap low-value filter — avoids paying for an
            //    embedding on text we would never accept anyway.
            const lowValue = isLowValueCandidate(candidate);
            if (lowValue.lowValue) {
                this.deps.logger?.debug?.(STAGE.low_value, {
                    candidateId: candidate.id,
                    reason: lowValue.reason,
                });
                return await this.finalize({
                    candidate,
                    decision: "ignore_low_value",
                    candidateStatus: "ignored_low_value",
                    reason: lowValue.reason,
                });
            }

            // 2. Exact normalized-text duplicate check. We trust text
            //    equality more than embedding similarity at the
            //    top, so this short-circuits before paying for an
            //    embedding call.
            const exactDuplicate = await this.deps.memoryStore.findExactActiveMemory({
                userId: candidate.source.userId,
                characterId: candidate.source.characterId,
                scope: candidate.scope,
                type: candidate.type,
                normalizedText: candidate.normalizedText,
            });
            if (exactDuplicate) {
                this.deps.logger?.debug?.(STAGE.duplicate, {
                    candidateId: candidate.id,
                    memoryId: exactDuplicate.id,
                });
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
            this.deps.logger?.debug?.(STAGE.embedding_requested, {
                candidateId: candidate.id,
            });
            let embedded: MemoryEmbedding;
            try {
                const result = await this.deps.embeddingProvider.embed({
                    text: candidate.text,
                    purpose: "memory.write.candidate",
                    userId: candidate.source.userId,
                });
                embedded = result.embedding;
            } catch (error) {
                const err = error instanceof Error ? error : new Error(String(error));
                this.deps.logger?.warn(STAGE.embedding_failed, {
                    candidateId: candidate.id,
                    message: err.message,
                });
                return await this.finalize({
                    candidate,
                    decision: "embedding_failed",
                    candidateStatus: "embedding_failed",
                    reason: err.message,
                });
            }

            await this.deps.candidateStore.saveCandidateEmbedding({
                candidateId: candidate.id,
                embedding: embedded,
                updatedAt: this.deps.clock.nowIso(),
            });

            // 4. Fetch existing memories in the same logical bucket
            //    and rank them. Signature filtering protects us from
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
            const { ranked, skipped } = this.rankWithSkipDiagnostics(
                embedded.vector,
                activeMemories,
                signature,
                candidate.id,
            );
            this.deps.logger?.debug?.(STAGE.similarity_scan_finished, {
                candidateId: candidate.id,
                scannedCount: activeMemories.length,
                rankedCount: ranked.length,
                skipped,
                totalSkipped: totalSkipped(skipped),
            });

            // 5. Decide.
            const decision = decideBySimilarity(ranked, this.policy);
            this.deps.logger?.debug?.(STAGE.decision_made, {
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
                    importance: this.deps.defaultImportance ?? DEFAULT_IMPORTANCE,
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
                this.deps.logger?.warn(STAGE.create_failed, {
                    candidateId: candidate.id,
                    message: err.message,
                });
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
            // Anything not caught above (store outage on the early
            // findExactActiveMemory etc.) ends as an "error" outcome
            // so the batch keeps moving.
            const err = error instanceof Error ? error : new Error(String(error));
            this.deps.logger?.warn("memory.commit.unhandled_error", {
                candidateId: candidate.id,
                message: err.message,
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
     *  - emit one `skipped_signature_mismatch` debug event per
     *    mismatched memory, so operators can see which specific
     *    rows were ignored (the breakdown only carries counts);
     *  - call {@link rankSimilarMemories}, which owns the canonical
     *    skip-counting logic and returns a structured breakdown
     *    with one cell per reason.
     *
     * Per-memory logging is restricted to signature mismatches
     * because that's the only reason we expect to investigate
     * individually ("why didn't this related memory rank?"). The
     * other reasons (`noEmbedding`, `corruptDim`,
     * `nonFiniteSimilarity`) are debugged via the aggregate counts:
     * if any of them is non-zero in production we want to find the
     * offending row by querying the table directly, not by reading
     * a noisy log.
     */
    private rankWithSkipDiagnostics(
        candidateVector: number[],
        memories: ActiveMemoryRecord[],
        signature: EmbeddingSignature,
        candidateId: string,
    ): { ranked: RankedMemory[]; skipped: MemoryRankSkipBreakdown } {
        for (const memory of memories) {
            const embedding = memory.embedding;
            if (!embedding) continue;
            if (signaturesMatch(embedding, signature)) continue;
            this.deps.logger?.debug?.(STAGE.skipped_signature_mismatch, {
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
     * Persist the candidate-status transition + decision row in a
     * single helper so all decision branches share the same shape
     * and the same logger call site. Returns a `MemoryCommitOutcome`
     * the caller can hand directly to the result list.
     */
    private async finalize(args: {
        candidate: MemoryCandidateRecord;
        decision: MemoryDecisionKind;
        candidateStatus: MemoryCandidateRecord["status"];
        memoryId?: string;
        reason?: string;
        similarity?: MemorySimilaritySummaryEntry[];
        topSimilarity?: number;
        scannedCount?: number;
        /**
         * Per-reason skip breakdown from the similarity scan. Cloned
         * into the outcome verbatim; callers should never see a
         * partial / mutated copy. Absent for branches that didn't
         * run a scan (low-value, exact-duplicate, embedding-failed,
         * pre-scan errors).
         */
        skipped?: MemoryRankSkipBreakdown;
        error?: Error;
    }): Promise<MemoryCommitOutcome> {
        const now = this.deps.clock.nowIso();
        await this.deps.candidateStore.updateCandidateStatus({
            candidateId: args.candidate.id,
            status: args.candidateStatus,
            reason: args.reason,
            updatedAt: now,
        });

        const decisionRecord: MemoryDecisionRecord = await this.deps.decisionStore.appendDecision({
            candidateId: args.candidate.id,
            userId: args.candidate.source.userId,
            characterId: args.candidate.source.characterId,
            decision: args.decision,
            memoryId: args.memoryId,
            reason: args.reason,
            similarity: args.similarity ?? [],
            policyVersion: this.policy.policyVersion,
            createdAt: now,
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

/** Re-exported so tests / debug API surfaces can share the same names. */
export { MEMORY_SCHEMA_VERSION };
