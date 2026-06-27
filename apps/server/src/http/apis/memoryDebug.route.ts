import {
    ApiListMemories,
    ApiListMemoryCandidates,
    ApiListMemoryDecisions,
    MEMORY_CANDIDATE_TYPES,
    MEMORY_SCOPES,
    type ActiveMemoryInfo,
    type ListMemoriesResponse,
    type ListMemoryCandidatesResponse,
    type ListMemoryDecisionsResponse,
    type MemoryCandidateInfo,
    type MemoryCandidateStatus,
    type MemoryCandidateType,
    type MemoryDecisionInfo,
    type MemoryDecisionKind,
    type MemoryEmbeddingSignature,
    type MemoryScope,
    type MemoryStatus,
} from "@ss-ai/contracts";
import type {
    ActiveMemoryRecord,
    MemoryCandidateRecord,
    MemoryDecisionRecord,
    MemoryEmbedding,
} from "@ss-ai/persona-flow";
import { registerApi } from "../registerApi.js";
import { AppHttpError, getAppErrorStatusCode } from "../errors/appHttpError.js";
import { resolveRequestUserId, toErrorResponse, type HttpApiContext } from "./apiContext.js";

const MEMORY_CANDIDATE_STATUSES = [
    "pending",
    "embedded",
    "committed",
    "ignored_duplicate",
    "ignored_low_value",
    "needs_judge",
    "embedding_failed",
    "commit_failed",
] as const satisfies readonly MemoryCandidateStatus[];

const MEMORY_STATUSES = ["active", "archived"] as const satisfies readonly MemoryStatus[];

const MEMORY_DECISION_KINDS = [
    "create",
    "ignore_duplicate",
    "ignore_low_value",
    "needs_judge",
    "embedding_failed",
    "error",
] as const satisfies readonly MemoryDecisionKind[];

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

// ── Query param helpers ────────────────────────────────────────────────────

/**
 * Returns a trimmed non-empty string from a query value, or
 * undefined. Express's query parser yields `string | string[]` so we
 * defensively coerce — if a caller repeats a key we only honour the
 * first value (subsequent values would shadow each other anyway for
 * single-string filters).
 */
function parseString(raw: unknown): string | undefined {
    if (Array.isArray(raw)) return parseString(raw[0]);
    if (typeof raw !== "string") return undefined;
    const trimmed = raw.trim();
    return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Accepts either a single value, a repeated query param
 * (`?status=a&status=b`) or a comma-separated list
 * (`?status=a,b`). Returns the matched tokens, or `undefined`
 * when nothing was provided.
 *
 * Strict for the debug surface: any token that is not in `allowed`
 * raises 400 `memory.debug.invalid_enum_value` rather than being
 * silently dropped. A typo like `?status=archivd` would otherwise
 * look like "no filter" and surface the full list, which is exactly
 * the confusion this debug page is supposed to avoid.
 */
function parseEnumList<T extends string>(
    raw: unknown,
    allowed: readonly T[],
    paramName: string,
): T[] | undefined {
    if (raw === undefined || raw === null) return undefined;
    const flat: unknown[] = Array.isArray(raw) ? raw : [raw];
    const tokens: string[] = [];
    for (const v of flat) {
        if (typeof v !== "string") continue;
        for (const piece of v.split(",")) {
            const trimmed = piece.trim();
            if (trimmed.length > 0) tokens.push(trimmed);
        }
    }
    if (tokens.length === 0) return undefined;
    const matched: T[] = [];
    for (const token of tokens) {
        if ((allowed as readonly string[]).includes(token)) {
            matched.push(token as T);
        } else {
            throw new AppHttpError(
                400,
                "memory.debug.invalid_enum_value",
                `Invalid value for ${paramName}: ${token}`,
                { param: paramName, value: token },
            );
        }
    }
    return matched;
}

/**
 * Clamps a user-supplied limit to `[1, MAX_LIMIT]`. Missing,
 * non-numeric, or non-positive values fall back to DEFAULT_LIMIT.
 * Rationale: the debug surface is meant to inspect recent rows;
 * unbounded scans would let the page lock up on large user data.
 */
function parseLimit(raw: unknown): number {
    const first = Array.isArray(raw) ? raw[0] : raw;
    if (first === undefined || first === null || first === "") return DEFAULT_LIMIT;
    const n = Number(first);
    if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
    return Math.min(Math.floor(n), MAX_LIMIT);
}

// ── Projections ────────────────────────────────────────────────────────────

function toEmbeddingSignature(embedding: MemoryEmbedding | undefined): MemoryEmbeddingSignature | null {
    if (!embedding) return null;
    return {
        provider: embedding.provider,
        model: embedding.model,
        dim: embedding.dim,
        version: embedding.version,
        createdAt: embedding.createdAt,
    };
}

function toCandidateInfo(record: MemoryCandidateRecord): MemoryCandidateInfo {
    return {
        id: record.id,
        userId: record.source.userId,
        characterId: record.source.characterId,
        conversationId: record.source.conversationId,
        userMessageId: record.source.userMessageId,
        assistantMessageId: record.source.assistantMessageId,
        requestId: record.source.requestId,
        modelCallPurpose: record.source.modelCallPurpose,
        seq: record.seq,
        scope: record.scope,
        type: record.type,
        text: record.text,
        normalizedText: record.normalizedText,
        relatedEntities: [...record.relatedEntities],
        tags: [...record.tags],
        reason: record.reason ?? null,
        status: record.status,
        embedding: toEmbeddingSignature(record.embedding),
        schemaVersion: record.schemaVersion,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
    };
}

function toMemoryInfo(record: ActiveMemoryRecord): ActiveMemoryInfo {
    return {
        id: record.id,
        userId: record.userId,
        characterId: record.characterId,
        scope: record.scope,
        type: record.type,
        text: record.text,
        normalizedText: record.normalizedText,
        relatedEntities: [...record.relatedEntities],
        tags: [...record.tags],
        sourceCandidateId: record.sourceCandidateId ?? null,
        sourceConversationId: record.sourceConversationId ?? null,
        sourceUserMessageId: record.sourceUserMessageId ?? null,
        sourceAssistantMessageId: record.sourceAssistantMessageId ?? null,
        status: record.status,
        importance: record.importance,
        embedding: toEmbeddingSignature(record.embedding),
        schemaVersion: record.schemaVersion,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
    };
}

function toDecisionInfo(record: MemoryDecisionRecord): MemoryDecisionInfo {
    return {
        id: record.id,
        candidateId: record.candidateId,
        userId: record.userId,
        characterId: record.characterId,
        decision: record.decision,
        memoryId: record.memoryId ?? null,
        reason: record.reason ?? null,
        similarity: record.similarity.map((s) => ({ ...s })),
        policyVersion: record.policyVersion,
        createdAt: record.createdAt,
    };
}

// ── Route registration ────────────────────────────────────────────────────

export function registerMemoryDebugRoutes(context: HttpApiContext): void {
    // GET /v1/debug/memory-candidates
    registerApi(context.app, ApiListMemoryCandidates, {
        handleRequest: async (req): Promise<ListMemoryCandidatesResponse> => {
            const userId = await resolveRequestUserId(req, context);
            const query = req.query;
            const rows = await context.stores.memoryCandidate.listCandidates({
                userId,
                characterId: parseString(query.characterId),
                conversationId: parseString(query.conversationId),
                assistantMessageId: parseString(query.assistantMessageId),
                status: parseEnumList(query.status, MEMORY_CANDIDATE_STATUSES, "status"),
                limit: parseLimit(query.limit),
            });
            return { candidates: rows.map(toCandidateInfo) };
        },
        handleError: (error) => ({ status: getAppErrorStatusCode(error, 400), body: toErrorResponse(error) }),
    });

    // GET /v1/debug/memories
    registerApi(context.app, ApiListMemories, {
        handleRequest: async (req): Promise<ListMemoriesResponse> => {
            const userId = await resolveRequestUserId(req, context);
            const characterId = parseString(req.query.characterId);
            // Every memory is bound to one character world. Without
            // `characterId` the port would not have a bucket to scan
            // and the response would be meaningless, so we fail fast
            // with 400 instead of silently returning [].
            if (!characterId) {
                throw new AppHttpError(
                    400,
                    "memory.debug.characterId_required",
                    "characterId is required",
                );
            }
            const rows = await context.stores.memory.listActiveMemories({
                userId,
                characterId,
                scope: parseEnumList<MemoryScope>(req.query.scope, MEMORY_SCOPES, "scope"),
                type: parseEnumList<MemoryCandidateType>(req.query.type, MEMORY_CANDIDATE_TYPES, "type"),
                // Debug API defaults to active-only so an unguarded
                // GET doesn't accidentally surface archived rows.
                // The underlying SQLite store has no implicit default,
                // so we make the policy explicit at the route layer.
                status: parseEnumList(req.query.status, MEMORY_STATUSES, "status") ?? ["active"],
                limit: parseLimit(req.query.limit),
            });
            return { memories: rows.map(toMemoryInfo) };
        },
        handleError: (error) => ({ status: getAppErrorStatusCode(error, 400), body: toErrorResponse(error) }),
    });

    // GET /v1/debug/memory-decisions
    registerApi(context.app, ApiListMemoryDecisions, {
        handleRequest: async (req): Promise<ListMemoryDecisionsResponse> => {
            const userId = await resolveRequestUserId(req, context);
            const rows = await context.stores.memoryDecision.listDecisions({
                userId,
                characterId: parseString(req.query.characterId),
                candidateId: parseString(req.query.candidateId),
                decision: parseEnumList(req.query.decision, MEMORY_DECISION_KINDS, "decision"),
                limit: parseLimit(req.query.limit),
            });
            return { decisions: rows.map(toDecisionInfo) };
        },
        handleError: (error) => ({ status: getAppErrorStatusCode(error, 400), body: toErrorResponse(error) }),
    });
}
