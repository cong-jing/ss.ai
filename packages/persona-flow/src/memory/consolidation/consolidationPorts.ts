import type {
    JudgeAction,
    MemoryConsolidationJudgeInput,
    MemoryConsolidationJudgeResult,
} from "./consolidationTypes.js";

/**
 * Consolidation ports.
 *
 * `MemoryConsolidationJudgeProvider` is the memory core's boundary
 * to the LLM judge. The default implementation is injected by the
 * composition layer (it wraps the `memory.consolidate` model call);
 * memory core never imports the model-call registry, so it stays
 * provider/framework free.
 */
export interface MemoryConsolidationJudgeProvider {
    judge(input: MemoryConsolidationJudgeInput): Promise<MemoryConsolidationJudgeResult>;
}

/** Decision audit row written for every staging row processed. */
export interface ConsolidationDecisionRecord {
    id: string;
    userId: string;
    characterId: string;
    memoryStagingId: string;
    action: JudgeAction;
    targetRetainedMemoryId?: string;
    createdRetainedMemoryId?: string;
    archivedRetainedMemoryIds: string[];
    judgeRequest: unknown;
    judgeResponse: unknown;
    validatedAction: unknown;
    status: "applied" | "rejected" | "failed";
    statusReason?: string;
    modelCallPurpose: string;
    model?: string;
    requestId?: string;
    createdAt: string;
}

export interface CreateConsolidationDecisionInput {
    id: string;
    userId: string;
    characterId: string;
    memoryStagingId: string;
    action: JudgeAction;
    targetRetainedMemoryId?: string;
    createdRetainedMemoryId?: string;
    archivedRetainedMemoryIds: string[];
    judgeRequest: unknown;
    judgeResponse: unknown;
    validatedAction: unknown;
    status: "applied" | "rejected" | "failed";
    statusReason?: string;
    modelCallPurpose: string;
    model?: string;
    requestId?: string;
    createdAt: string;
}

export interface FindAppliedDecisionInput {
    memoryStagingId: string;
}

export interface ListConsolidationDecisionsInput {
    userId: string;
    characterId?: string;
    memoryStagingId?: string;
    action?: JudgeAction | JudgeAction[];
    status?: ConsolidationDecisionRecord["status"] | ConsolidationDecisionRecord["status"][];
    limit?: number;
}

/**
 * Audit store for consolidation decisions. `findApplied` enforces
 * the idempotency invariant: at most one `applied` decision per
 * staging row.
 */
export interface MemoryConsolidationDecisionStore {
    create(input: CreateConsolidationDecisionInput): Promise<ConsolidationDecisionRecord>;
    findApplied(input: FindAppliedDecisionInput): Promise<ConsolidationDecisionRecord | undefined>;
    list(input: ListConsolidationDecisionsInput): Promise<ConsolidationDecisionRecord[]>;
}
