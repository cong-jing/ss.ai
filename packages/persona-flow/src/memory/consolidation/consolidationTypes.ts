import type { MemoryCandidateType, MemoryScope } from "@ss-ai/contracts";
import type { MemoryEmbedding } from "../embedding/embeddingPorts.js";

/**
 * Memory retained consolidation domain types.
 *
 * The judge is allowed to *suggest* one of these actions; the system
 * layer validates and applies them. This file is provider-free: it
 * describes the data shapes the processor, the judge port, and the
 * decision audit store exchange, not how an LLM produces them.
 */

/**
 * Action the LLM judge recommends for one staging evidence row.
 *
 * `create` — promote to a new retained memory.
 * `update` — rewrite one existing retained memory.
 * `merge` — rewrite one target AND archive other redundant rows.
 * `ignore` — not worth long-term keeping; no retained write.
 * `archive_retained` — archive stale retained rows only.
 * `uncertain` — judge declines to decide; system applies a no-op.
 */
export const JUDGE_ACTIONS = [
    "create",
    "update",
    "merge",
    "ignore",
    "archive_retained",
    "uncertain",
] as const;

export type JudgeAction = typeof JUDGE_ACTIONS[number];

/** One related retained memory surfaced to the judge as context. */
export interface JudgeRetainedCandidate {
    id: string;
    scope: MemoryScope;
    type: MemoryCandidateType;
    text: string;
    importance: number;
    occurrenceCount: number;
    similarity?: number;
}

/** Source candidate summary for one staging row. */
export interface JudgeSourceCandidate {
    candidateId: string;
    text: string;
    reason?: string;
    conversationId: string;
    createdAt: string;
}

/** Provider-neutral input handed to the judge for one staging row. */
export interface MemoryConsolidationJudgeInput {
    staging: {
        id: string;
        scope: MemoryScope;
        type: MemoryCandidateType;
        text: string;
        normalizedText: string;
        relatedEntities: string[];
        tags: string[];
        occurrenceCount: number;
        firstSeenAt: string;
        lastSeenAt: string;
    };
    sourceCandidates: JudgeSourceCandidate[];
    relatedRetained: JudgeRetainedCandidate[];
    character: {
        displayName: string;
        personaSummary?: string;
    };
    policy: {
        allowedActions: JudgeAction[];
        importanceMin: number;
        importanceMax: number;
        schemaVersion: number;
    };
}

/** The judge's raw recommendation, before system validation. */
export interface MemoryConsolidationJudgeResult {
    action: JudgeAction;
    targetRetainedMemoryId?: string;
    text?: string;
    importance?: number;
    relatedEntities?: string[];
    tags?: string[];
    archiveRetainedMemoryIds?: string[];
    reasoning: string;
    confidence?: number;
    raw?: unknown;
    model?: string;
    requestId?: string;
}

/** System-validated action that the processor will actually apply. */
export interface ValidatedConsolidationAction {
    action: JudgeAction;
    targetRetainedMemoryId?: string;
    text?: string;
    importance?: number;
    relatedEntities?: string[];
    tags?: string[];
    archiveRetainedMemoryIds: string[];
}

/** Final outcome reported per staging row processed. */
export interface MemoryRetainedConsolidationOutcome {
    memoryStagingId: string;
    action: JudgeAction;
    auditStatus: "applied" | "rejected" | "failed";
    statusReason: string;
    stagingStatus: "processed" | "archived" | "failed";
    createdRetainedMemoryId?: string;
    targetRetainedMemoryId?: string;
    archivedRetainedMemoryIds: string[];
    error?: Error;
}

/** Persisted retained embedding reuse type alias. */
export type ConsolidationEmbedding = MemoryEmbedding;
