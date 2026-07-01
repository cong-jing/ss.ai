import type {
    JudgeAction,
    MemoryConsolidationJudgeResult,
    ValidatedConsolidationAction,
} from "./consolidationTypes.js";

export interface ValidateJudgeResultInput {
    judge: MemoryConsolidationJudgeResult;
    allowedRetainedIds: Set<string>;
    importanceMin: number;
    importanceMax: number;
}

export type JudgeValidation =
    | { ok: true; action: ValidatedConsolidationAction }
    | { ok: false; reason: string };

/**
 * System-side validation of an LLM judge recommendation. The judge
 * may only suggest; the system rejects anything that references
 * unknown ids, mutates immutable fields, or breaks the action's
 * required-field contract. Invalid output is rejected (never thrown)
 * so the processor can fail-soft and audit it.
 */
export function validateJudgeResult(input: ValidateJudgeResultInput): JudgeValidation {
    const { judge, allowedRetainedIds, importanceMin, importanceMax } = input;
    const action = judge.action as JudgeAction;

    const text = typeof judge.text === "string" ? judge.text.trim() : "";
    const target = judge.targetRetainedMemoryId;
    const archiveIds = Array.isArray(judge.archiveRetainedMemoryIds)
        ? judge.archiveRetainedMemoryIds.filter((id) => typeof id === "string")
        : [];

    if (target !== undefined && !allowedRetainedIds.has(target)) {
        return { ok: false, reason: "invalid_target_id" };
    }
    for (const id of archiveIds) {
        if (!allowedRetainedIds.has(id)) {
            return { ok: false, reason: "invalid_archive_id" };
        }
    }

    let importance: number | undefined;
    if (judge.importance !== undefined) {
        if (!Number.isFinite(judge.importance)) {
            return { ok: false, reason: "invalid_importance" };
        }
        const rounded = Math.round(judge.importance);
        if (rounded < importanceMin || rounded > importanceMax) {
            return { ok: false, reason: "importance_out_of_range" };
        }
        importance = rounded;
    }

    switch (action) {
        case "create":
            if (!text) return { ok: false, reason: "create_missing_text" };
            return base({ action, text, importance, archiveIds: [] });
        case "update":
            if (!target) return { ok: false, reason: "update_missing_target" };
            if (!text) return { ok: false, reason: "update_missing_text" };
            return base({ action, target, text, importance, archiveIds: [] });
        case "merge":
            if (!target) return { ok: false, reason: "merge_missing_target" };
            if (!text) return { ok: false, reason: "merge_missing_text" };
            return base({ action, target, text, importance, archiveIds });
        case "ignore":
            if (text) return { ok: false, reason: "ignore_has_text" };
            return base({ action, archiveIds: [] });
        case "archive_retained":
            if (archiveIds.length === 0) return { ok: false, reason: "archive_missing_ids" };
            return base({ action, archiveIds });
        case "uncertain":
            return base({ action, archiveIds: [] });
        default:
            return { ok: false, reason: "unknown_action" };
    }

    function base(p: {
        action: JudgeAction;
        target?: string;
        text?: string;
        importance?: number;
        archiveIds: string[];
    }): JudgeValidation {
        const result: ValidatedConsolidationAction = {
            action: p.action,
            archiveRetainedMemoryIds: p.archiveIds,
        };
        if (p.target !== undefined) result.targetRetainedMemoryId = p.target;
        if (p.text !== undefined) result.text = p.text;
        if (p.importance !== undefined) result.importance = p.importance;
        if (Array.isArray(judge.relatedEntities)) {
            result.relatedEntities = judge.relatedEntities.filter((e) => typeof e === "string");
        }
        if (Array.isArray(judge.tags)) {
            result.tags = judge.tags.filter((t) => typeof t === "string");
        }
        return { ok: true, action: result };
    }
}
