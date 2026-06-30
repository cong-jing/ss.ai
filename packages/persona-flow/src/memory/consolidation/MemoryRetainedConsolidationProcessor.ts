import type { MemoryEmbedding, MemoryEmbeddingProvider } from "../embedding/embeddingPorts.js";
import type { MemoryStagingRecord } from "../staging/memoryStagingTypes.js";
import type { MemoryStagingStore } from "../staging/memoryStagingPorts.js";
import type { MemoryRetainedRecord, MemoryRetainedStore } from "../stores/memoryRetainedStorePort.js";
import {
    cosineSimilarity,
    signaturesMatch,
    type EmbeddingSignature,
} from "../ranking/similarity.js";
import type { MemorySettings } from "../settings.js";
import type { MemoryClock, MemoryIdGenerator, MemoryLogger } from "../types.js";
import type {
    MemoryConsolidationDecisionStore,
    MemoryConsolidationJudgeProvider,
} from "./consolidationPorts.js";
import type {
    JudgeRetainedCandidate,
    JudgeSourceCandidate,
    MemoryConsolidationJudgeInput,
    MemoryRetainedConsolidationOutcome,
} from "./consolidationTypes.js";
import { validateJudgeResult } from "./consolidationValidation.js";

/** Minimal character context needed to build the judge prompt. */
export interface ConsolidationCharacterContextProvider {
    get(input: { userId: string; characterId: string }): Promise<{
        displayName: string;
        personaSummary?: string;
    } | undefined>;
}

/** Source candidate lookup for judge evidence. */
export interface ConsolidationCandidateLookup {
    listForStaging(input: {
        memoryStagingId: string;
        limit: number;
    }): Promise<JudgeSourceCandidate[]>;
}

export interface ProcessPendingMemoryStagingInput {
    userId: string;
    characterId: string;
    limit?: number;
}

export interface ProcessPendingMemoryStagingResult {
    outcomes: MemoryRetainedConsolidationOutcome[];
}

export interface MemoryRetainedConsolidationProcessorDeps {
    stagingStore: MemoryStagingStore;
    retainedStore: MemoryRetainedStore;
    decisionStore: MemoryConsolidationDecisionStore;
    judgeProvider: MemoryConsolidationJudgeProvider;
    embeddingProvider: MemoryEmbeddingProvider;
    characterContext: ConsolidationCharacterContextProvider;
    candidateLookup: ConsolidationCandidateLookup;
    clock: MemoryClock;
    ids: MemoryIdGenerator;
    settings: MemorySettings;
    logger?: MemoryLogger;
}

const MODEL_CALL_PURPOSE = "memory.consolidate";

/**
 * Drives staging -> retained consolidation: pull pending staging,
 * retrieve related retained, ask the judge, validate, apply the
 * system action, write an audit, and update staging status. The LLM
 * judge only advises; this processor owns persistence, idempotency,
 * and fail-soft. It never throws to the caller.
 */
export class MemoryRetainedConsolidationProcessor {
    constructor(private readonly deps: MemoryRetainedConsolidationProcessorDeps) { }

    async processPending(input: ProcessPendingMemoryStagingInput): Promise<ProcessPendingMemoryStagingResult> {
        const limit = input.limit ?? this.deps.settings.retained.batchLimit;
        const pending = await this.deps.stagingStore.listPending({
            userId: input.userId,
            characterId: input.characterId,
            limit,
        });
        const outcomes: MemoryRetainedConsolidationOutcome[] = [];
        for (const staging of pending) {
            outcomes.push(await this.processOne(staging));
        }
        return { outcomes };
    }

    private async processOne(staging: MemoryStagingRecord): Promise<MemoryRetainedConsolidationOutcome> {
        const now = this.deps.clock.nowIso();
        try {
            // Idempotency: a previous run already applied this row.
            const applied = await this.deps.decisionStore.findApplied({ memoryStagingId: staging.id });
            if (applied) {
                await this.safeUpdateStaging(staging.id, "processed", "idempotent_already_applied", now);
                return {
                    memoryStagingId: staging.id,
                    action: applied.action,
                    auditStatus: "applied",
                    statusReason: "idempotent_already_applied",
                    stagingStatus: "processed",
                    archivedRetainedMemoryIds: applied.archivedRetainedMemoryIds,
                };
            }

            const sources = await this.deps.candidateLookup.listForStaging({
                memoryStagingId: staging.id,
                limit: this.deps.settings.retained.judge.maxSourceCandidates,
            });
            const relatedRetained = await this.retrieveRelated(staging);

            const judgeInput = this.buildJudgeInput(staging, sources, relatedRetained,
                await this.deps.characterContext.get({ userId: staging.userId, characterId: staging.characterId }));

            const judge = await this.deps.judgeProvider.judge(judgeInput);
            const allowedIds = new Set(relatedRetained.map((r) => r.id));
            const validated = validateJudgeResult({
                judge,
                allowedRetainedIds: allowedIds,
                importanceMin: this.deps.settings.retained.importance.min,
                importanceMax: this.deps.settings.retained.importance.max,
            });

            if (!validated.ok) {
                await this.writeDecision(staging, judgeInput, judge, undefined, "rejected", "invalid_judge_output");
                await this.safeUpdateStaging(staging.id, "failed", `invalid_judge_output:${validated.reason}`, now);
                return this.outcome(staging.id, judge.action, "rejected", "invalid_judge_output", "failed", []);
            }

            const action = validated.action;
            switch (action.action) {
                case "create":
                    return await this.applyCreate(staging, judgeInput, judge, action.text!, action, now);
                case "update":
                case "merge":
                    return await this.applyUpdate(staging, judgeInput, judge, action, now);
                case "ignore":
                    await this.writeDecision(staging, judgeInput, judge, validated.action, "applied", "ignored_by_judge");
                    await this.safeUpdateStaging(staging.id, "processed", "ignored_by_judge", now);
                    return this.outcome(staging.id, "ignore", "applied", "ignored_by_judge", "processed", []);
                case "archive_retained":
                    await this.archiveMany(action.archiveRetainedMemoryIds, "archived_by_judge", now);
                    await this.writeDecision(staging, judgeInput, judge, validated.action, "applied", "archived_by_judge");
                    await this.safeUpdateStaging(staging.id, "processed", "archived_by_judge", now);
                    return this.outcome(staging.id, "archive_retained", "applied", "archived_by_judge", "processed", action.archiveRetainedMemoryIds);
                case "uncertain":
                default:
                    await this.writeDecision(staging, judgeInput, judge, validated.action, "applied", "judge_uncertain");
                    await this.safeUpdateStaging(staging.id, "processed", "judge_uncertain", now);
                    return this.outcome(staging.id, "uncertain", "applied", "judge_uncertain", "processed", []);
            }
        } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            this.deps.logger?.warn("memory.consolidation.failed", {
                memoryStagingId: staging.id,
                error: err.message,
            });
            await this.safeUpdateStaging(staging.id, "failed", "judge_failed", now);
            return {
                memoryStagingId: staging.id,
                action: "uncertain",
                auditStatus: "failed",
                statusReason: "judge_failed",
                stagingStatus: "failed",
                archivedRetainedMemoryIds: [],
                error: err,
            };
        }
    }

    private async applyCreate(
        staging: MemoryStagingRecord,
        judgeInput: MemoryConsolidationJudgeInput,
        judge: import("./consolidationTypes.js").MemoryConsolidationJudgeResult,
        text: string,
        action: import("./consolidationTypes.js").ValidatedConsolidationAction,
        now: string,
    ): Promise<MemoryRetainedConsolidationOutcome> {
        const embedding = await this.embedOrUndefined(text, staging.userId);
        if (!embedding) {
            await this.writeDecision(staging, judgeInput, judge, action, "failed", "retained_embedding_failed");
            await this.safeUpdateStaging(staging.id, "failed", "retained_embedding_failed", now);
            return this.outcome(staging.id, "create", "failed", "retained_embedding_failed", "failed", []);
        }
        const id = this.deps.ids.randomId();
        try {
            await this.deps.retainedStore.create({
                id,
                userId: staging.userId,
                characterId: staging.characterId,
                scope: staging.scope,
                type: staging.type,
                text,
                normalizedText: action.text ? action.text.trim() : staging.normalizedText,
                relatedEntities: action.relatedEntities ?? [...staging.relatedEntities],
                tags: action.tags ?? [...staging.tags],
                sourceStagingId: staging.id,
                status: "active",
                importance: action.importance ?? this.deps.settings.retained.importance.default,
                occurrenceCount: staging.occurrenceCount,
                firstSeenAt: staging.firstSeenAt,
                lastSeenAt: staging.lastSeenAt,
                embedding,
                now,
            });
        } catch (err) {
            const error = err instanceof Error ? err : new Error(String(err));
            await this.writeDecision(staging, judgeInput, judge, action, "failed", "retained_store_failed");
            await this.safeUpdateStaging(staging.id, "failed", "retained_store_failed", now);
            return { ...this.outcome(staging.id, "create", "failed", "retained_store_failed", "failed", []), error };
        }
        await this.writeDecision(staging, judgeInput, judge, action, "applied", "retained_created", id);
        await this.safeUpdateStaging(staging.id, "processed", "retained_created", now);
        return { ...this.outcome(staging.id, "create", "applied", "retained_created", "processed", []), createdRetainedMemoryId: id };
    }

    private async applyUpdate(
        staging: MemoryStagingRecord,
        judgeInput: MemoryConsolidationJudgeInput,
        judge: import("./consolidationTypes.js").MemoryConsolidationJudgeResult,
        action: import("./consolidationTypes.js").ValidatedConsolidationAction,
        now: string,
    ): Promise<MemoryRetainedConsolidationOutcome> {
        const target = action.targetRetainedMemoryId!;
        const text = action.text!;
        const embedding = await this.embedOrUndefined(text, staging.userId);
        if (!embedding) {
            await this.writeDecision(staging, judgeInput, judge, action, "failed", "retained_embedding_failed");
            await this.safeUpdateStaging(staging.id, "failed", "retained_embedding_failed", now);
            return this.outcome(staging.id, action.action, "failed", "retained_embedding_failed", "failed", []);
        }
        try {
            await this.deps.retainedStore.update({
                memoryRetainedId: target,
                text,
                normalizedText: text.trim(),
                ...(action.relatedEntities ? { relatedEntities: action.relatedEntities } : {}),
                ...(action.tags ? { tags: action.tags } : {}),
                ...(action.importance !== undefined ? { importance: action.importance } : {}),
                occurrenceDelta: staging.occurrenceCount,
                lastSeenAt: staging.lastSeenAt,
                embedding,
                updatedAt: now,
            });
            // merge: archive redundant retained rows.
            if (action.action === "merge") {
                await this.archiveMany(action.archiveRetainedMemoryIds, "merged_into_target", now);
            }
        } catch (err) {
            const error = err instanceof Error ? err : new Error(String(err));
            await this.writeDecision(staging, judgeInput, judge, action, "failed", "retained_store_failed");
            await this.safeUpdateStaging(staging.id, "failed", "retained_store_failed", now);
            return { ...this.outcome(staging.id, action.action, "failed", "retained_store_failed", "failed", action.archiveRetainedMemoryIds), error };
        }
        const reason = action.action === "merge" ? "retained_merged" : "retained_updated";
        await this.writeDecision(staging, judgeInput, judge, action, "applied", reason);
        await this.safeUpdateStaging(staging.id, "processed", reason, now);
        return {
            ...this.outcome(staging.id, action.action, "applied", reason, "processed", action.archiveRetainedMemoryIds),
            targetRetainedMemoryId: target,
        };
    }

    private async archiveMany(ids: string[], reason: string, now: string): Promise<void> {
        for (const id of ids) {
            await this.deps.retainedStore.archive({ memoryRetainedId: id, statusReason: reason, updatedAt: now });
        }
    }

    private async retrieveRelated(staging: MemoryStagingRecord): Promise<JudgeRetainedCandidate[]> {
        const retrieval = this.deps.settings.retained.retrieval;
        const rows = await this.deps.retainedStore.list({
            userId: staging.userId,
            characterId: staging.characterId,
            scope: staging.scope,
            type: staging.type,
            status: "active",
            limit: retrieval.listLimit,
        });
        const stagingEmbedding = staging.embedding;
        const sig: EmbeddingSignature | undefined = stagingEmbedding
            ? { provider: stagingEmbedding.provider, model: stagingEmbedding.model, dim: stagingEmbedding.dim, version: stagingEmbedding.version }
            : undefined;

        const scored = rows.map((row) => {
            let similarity: number | undefined;
            if (stagingEmbedding && sig && row.embedding && signaturesMatch(row.embedding, sig)) {
                const s = cosineSimilarity(stagingEmbedding.vector, row.embedding.vector);
                if (Number.isFinite(s)) similarity = s;
            }
            const exact = row.normalizedText === staging.normalizedText;
            return { row, similarity, exact };
        });
        const min = retrieval.minSimilarityForJudgeContext;
        const filtered = min === undefined
            ? scored
            : scored.filter((s) => s.exact || (s.similarity !== undefined && s.similarity >= min));
        filtered.sort((a, b) => {
            if (a.exact !== b.exact) return a.exact ? -1 : 1;
            return (b.similarity ?? -1) - (a.similarity ?? -1);
        });
        return filtered.slice(0, retrieval.topK).map(({ row, similarity }) => ({
            id: row.id,
            scope: row.scope,
            type: row.type,
            text: row.text,
            importance: row.importance,
            occurrenceCount: row.occurrenceCount,
            ...(similarity !== undefined ? { similarity } : {}),
        }));
    }

    private buildJudgeInput(
        staging: MemoryStagingRecord,
        sources: JudgeSourceCandidate[],
        relatedRetained: JudgeRetainedCandidate[],
        character: { displayName: string; personaSummary?: string } | undefined,
    ): MemoryConsolidationJudgeInput {
        const cap = this.deps.settings.retained.judge;
        return {
            staging: {
                id: staging.id,
                scope: staging.scope,
                type: staging.type,
                text: staging.text,
                normalizedText: staging.normalizedText,
                relatedEntities: staging.relatedEntities,
                tags: staging.tags,
                occurrenceCount: staging.occurrenceCount,
                firstSeenAt: staging.firstSeenAt,
                lastSeenAt: staging.lastSeenAt,
            },
            sourceCandidates: sources.slice(0, cap.maxSourceCandidates),
            relatedRetained: relatedRetained.slice(0, cap.maxRetainedForPrompt),
            character: {
                displayName: character?.displayName ?? "",
                ...(character?.personaSummary ? { personaSummary: character.personaSummary } : {}),
            },
            policy: {
                allowedActions: ["create", "update", "merge", "ignore", "archive_retained", "uncertain"],
                importanceMin: this.deps.settings.retained.importance.min,
                importanceMax: this.deps.settings.retained.importance.max,
                schemaVersion: 1,
            },
        };
    }

    private async embedOrUndefined(text: string, userId: string): Promise<MemoryEmbedding | undefined> {
        try {
            const r = await this.deps.embeddingProvider.embed({ text, purpose: "memory.retained", userId });
            return r.embedding;
        } catch (err) {
            this.deps.logger?.warn("memory.consolidation.embed_failed", {
                error: err instanceof Error ? err.message : String(err),
            });
            return undefined;
        }
    }

    private async writeDecision(
        staging: MemoryStagingRecord,
        judgeInput: MemoryConsolidationJudgeInput,
        judge: import("./consolidationTypes.js").MemoryConsolidationJudgeResult,
        validatedAction: import("./consolidationTypes.js").ValidatedConsolidationAction | undefined,
        status: "applied" | "rejected" | "failed",
        statusReason: string,
        createdRetainedMemoryId?: string,
    ): Promise<void> {
        try {
            await this.deps.decisionStore.create({
                id: this.deps.ids.randomId(),
                userId: staging.userId,
                characterId: staging.characterId,
                memoryStagingId: staging.id,
                action: judge.action,
                ...(validatedAction?.targetRetainedMemoryId ? { targetRetainedMemoryId: validatedAction.targetRetainedMemoryId } : {}),
                ...(createdRetainedMemoryId ? { createdRetainedMemoryId } : {}),
                archivedRetainedMemoryIds: validatedAction?.archiveRetainedMemoryIds ?? [],
                judgeRequest: judgeInput,
                judgeResponse: judge.raw ?? judge,
                validatedAction: validatedAction ?? null,
                status,
                statusReason,
                modelCallPurpose: MODEL_CALL_PURPOSE,
                ...(judge.model ? { model: judge.model } : {}),
                ...(judge.requestId ? { requestId: judge.requestId } : {}),
                createdAt: this.deps.clock.nowIso(),
            });
        } catch (err) {
            this.deps.logger?.warn("memory.consolidation.audit_write_failed", {
                memoryStagingId: staging.id,
                error: err instanceof Error ? err.message : String(err),
            });
        }
    }

    private async safeUpdateStaging(
        id: string,
        status: "processed" | "failed" | "archived",
        reason: string,
        now: string,
    ): Promise<void> {
        try {
            await this.deps.stagingStore.updateStatus({ memoryStagingId: id, status, statusReason: reason, updatedAt: now });
        } catch (err) {
            this.deps.logger?.warn("memory.consolidation.staging_status_failed", {
                memoryStagingId: id,
                error: err instanceof Error ? err.message : String(err),
            });
        }
    }

    private outcome(
        memoryStagingId: string,
        action: import("./consolidationTypes.js").JudgeAction,
        auditStatus: "applied" | "rejected" | "failed",
        statusReason: string,
        stagingStatus: "processed" | "archived" | "failed",
        archivedRetainedMemoryIds: string[],
    ): MemoryRetainedConsolidationOutcome {
        return { memoryStagingId, action, auditStatus, statusReason, stagingStatus, archivedRetainedMemoryIds };
    }
}
