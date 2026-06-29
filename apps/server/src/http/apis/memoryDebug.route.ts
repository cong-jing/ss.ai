import {
    ApiListMemoryCandidates,
    ApiListMemoryRetained,
    ApiListMemoryStaging,
    MEMORY_CANDIDATE_TYPES,
    MEMORY_SCOPES,
    type ListMemoryCandidatesResponse,
    type ListMemoryRetainedResponse,
    type ListMemoryStagingResponse,
    type MemoryCandidateInfo,
    type MemoryCandidateStatus,
    type MemoryCandidateType,
    type MemoryEmbeddingSignature,
    type MemoryRetainedInfo,
    type MemoryRetainedStatus,
    type MemoryScope,
    type MemoryStagingInfo,
    type MemoryStagingStatus,
} from "@ss-ai/contracts";
import type {
    MemoryCandidateRecord,
    MemoryEmbedding,
    MemoryRetainedRecord,
    MemoryStagingRecord,
} from "@ss-ai/persona-flow";
import { registerApi } from "../registerApi.js";
import { AppHttpError, getAppErrorStatusCode } from "../errors/appHttpError.js";
import { resolveRequestUserId, toErrorResponse, type HttpApiContext } from "./apiContext.js";

// Allowlists for query-string enums. Mirrors the Batch 3.5 lifecycle
// constants in `@ss-ai/persona-flow`. Declared as `as const satisfies …`
// so the TS compiler enforces the mirror at the type level.
const MEMORY_CANDIDATE_STATUSES = [
    "pending",
    "processing",
    "processed",
    "rejected_by_rule",
    "failed",
] as const satisfies readonly MemoryCandidateStatus[];

const MEMORY_STAGING_STATUSES = [
    "pending",
    "processed",
    "archived",
    "forgotten",
    "failed",
] as const satisfies readonly MemoryStagingStatus[];

const MEMORY_RETAINED_STATUSES = ["active", "archived"] as const satisfies readonly MemoryRetainedStatus[];

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
        relatedEntities: [...record.relatedEntities],
        tags: [...record.tags],
        candidateReason: record.candidateReason ?? null,
        status: record.status,
        statusReason: record.statusReason ?? null,
        schemaVersion: record.schemaVersion,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
    };
}

function toStagingInfo(record: MemoryStagingRecord): MemoryStagingInfo {
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
        status: record.status,
        statusReason: record.statusReason ?? null,
        occurrenceCount: record.occurrenceCount,
        firstSeenAt: record.firstSeenAt,
        lastSeenAt: record.lastSeenAt,
        embedding: toEmbeddingSignature(record.embedding),
        schemaVersion: record.schemaVersion,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
    };
}

function toRetainedInfo(record: MemoryRetainedRecord): MemoryRetainedInfo {
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
        status: record.status,
        importance: record.importance,
        embedding: toEmbeddingSignature(record.embedding),
        schemaVersion: record.schemaVersion,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
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

    // GET /v1/debug/memory-staging
    registerApi(context.app, ApiListMemoryStaging, {
        handleRequest: async (req): Promise<ListMemoryStagingResponse> => {
            const userId = await resolveRequestUserId(req, context);
            const rows = await context.stores.memoryStaging.list({
                userId,
                characterId: parseString(req.query.characterId),
                scope: parseEnumList<MemoryScope>(req.query.scope, MEMORY_SCOPES, "scope"),
                type: parseEnumList<MemoryCandidateType>(req.query.type, MEMORY_CANDIDATE_TYPES, "type"),
                status: parseEnumList(req.query.status, MEMORY_STAGING_STATUSES, "status"),
                sourceCandidateId: parseString(req.query.sourceCandidateId),
                limit: parseLimit(req.query.limit),
            });
            return { staging: rows.map(toStagingInfo) };
        },
        handleError: (error) => ({ status: getAppErrorStatusCode(error, 400), body: toErrorResponse(error) }),
    });

    // GET /v1/debug/memory-retained
    registerApi(context.app, ApiListMemoryRetained, {
        handleRequest: async (req): Promise<ListMemoryRetainedResponse> => {
            const userId = await resolveRequestUserId(req, context);
            const characterId = parseString(req.query.characterId);
            // Every retained memory is bound to one character world.
            // Without `characterId` the port would not have a bucket
            // to scan and the response would be meaningless, so we
            // fail fast with 400 instead of silently returning [].
            if (!characterId) {
                throw new AppHttpError(
                    400,
                    "memory.debug.characterId_required",
                    "characterId is required",
                );
            }
            const rows = await context.stores.memoryRetained.list({
                userId,
                characterId,
                scope: parseEnumList<MemoryScope>(req.query.scope, MEMORY_SCOPES, "scope"),
                type: parseEnumList<MemoryCandidateType>(req.query.type, MEMORY_CANDIDATE_TYPES, "type"),
                // Debug API defaults to active-only so an unguarded
                // GET doesn't accidentally surface archived rows.
                // The underlying store has no implicit default, so we
                // make the policy explicit at the route layer.
                status: parseEnumList(req.query.status, MEMORY_RETAINED_STATUSES, "status") ?? ["active"],
                limit: parseLimit(req.query.limit),
            });
            return { retained: rows.map(toRetainedInfo) };
        },
        handleError: (error) => ({ status: getAppErrorStatusCode(error, 400), body: toErrorResponse(error) }),
    });
}
