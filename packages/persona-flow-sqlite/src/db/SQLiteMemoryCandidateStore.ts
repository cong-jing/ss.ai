import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { memoryCandidates, type MemoryCandidateRow, type NewMemoryCandidateRow } from "./schema.js";
import type { DrizzleDb } from "./openDatabase.js";
import type {
    AppendMemoryCandidatesInput,
    ListMemoryCandidatesInput,
    MemoryCandidateRecord,
    MemoryCandidateStatus,
    MemoryCandidateStore,
    MemoryClock,
    MemoryEmbedding,
    MemoryIdGenerator,
    MemoryLogger,
    SaveCandidateEmbeddingInput,
    UpdateMemoryCandidateStatusInput,
} from "@ss-ai/persona-flow";

/**
 * SQLite-backed implementation of {@link MemoryCandidateStore}.
 *
 * Persists per-turn memory candidates with their normalized text and,
 * once embedded, their full {@link MemoryEmbedding} blob (vector +
 * provider/model/dim/version + createdAt) in a single TEXT column
 * encoded as JSON. We keep the vector in JSON for Batch 2/3 because
 * SQLite has no native vector type and the candidate volume is
 * bounded by chat turns. The column moves to a dedicated table or a
 * vector engine later if ANN search becomes a real requirement.
 *
 * Failure-mode invariants:
 *  - JSON parsing failures on read are caught per row and logged via
 *    `logger.warn`; the offending row is returned without an
 *    embedding so the commit service routes it through the
 *    "no-embedding skip" path rather than crashing the chat turn.
 *  - Multi-row `appendCandidates` runs inside a single sqlite
 *    transaction so a `seq` collision (very unlikely; we own the
 *    counter externally) never leaves partial state behind.
 */
export class SQLiteMemoryCandidateStore implements MemoryCandidateStore {
    private readonly db: DrizzleDb;
    private readonly clock: MemoryClock;
    private readonly ids: MemoryIdGenerator;
    private readonly logger?: MemoryLogger;

    constructor(deps: {
        db: DrizzleDb;
        clock: MemoryClock;
        ids: MemoryIdGenerator;
        logger?: MemoryLogger;
    }) {
        this.db = deps.db;
        this.clock = deps.clock;
        this.ids = deps.ids;
        this.logger = deps.logger;
    }

    async appendCandidates(input: AppendMemoryCandidatesInput): Promise<MemoryCandidateRecord[]> {
        if (input.candidates.length === 0) return [];
        if (input.candidates.length !== input.normalizedTexts.length) {
            throw new Error(
                `SQLiteMemoryCandidateStore.appendCandidates: candidates.length (${input.candidates.length}) `
                + `!= normalizedTexts.length (${input.normalizedTexts.length})`,
            );
        }

        // `seq` is monotonically increasing per (user, conversation,
        // assistantMessageId) bucket so two concurrent turns on the
        // same conversation don't collide on indexes that include
        // `seq`. Read-then-write is safe here because each assistant
        // turn is single-writer (one chat-turn request per turn id).
        const baseSeq = await this.getNextSeq(
            input.source.userId,
            input.source.conversationId,
            input.source.assistantMessageId,
        );
        const now = this.clock.nowIso();
        const rows: NewMemoryCandidateRow[] = [];
        const records: MemoryCandidateRecord[] = [];

        for (let i = 0; i < input.candidates.length; i += 1) {
            const draft = input.candidates[i]!;
            const normalized = input.normalizedTexts[i]!;
            const id = this.ids.randomId();
            const seq = baseSeq + i;
            const status: MemoryCandidateStatus = "pending";
            const schemaVersion = 1;
            const row: NewMemoryCandidateRow = {
                id,
                userId: input.source.userId,
                characterId: input.source.characterId,
                conversationId: input.source.conversationId,
                userMessageId: input.source.userMessageId,
                assistantMessageId: input.source.assistantMessageId,
                requestId: input.source.requestId,
                modelCallPurpose: input.source.modelCallPurpose,
                seq,
                scope: draft.scope,
                type: draft.type,
                text: draft.text,
                normalizedText: normalized,
                relatedEntitiesJson: JSON.stringify(draft.relatedEntities ?? []),
                tagsJson: JSON.stringify(draft.tags ?? []),
                reason: draft.reason ?? null,
                status,
                embeddingJson: null,
                schemaVersion,
                createdAt: now,
                updatedAt: now,
            };
            rows.push(row);
            records.push({
                id,
                source: { ...input.source },
                seq,
                scope: draft.scope,
                type: draft.type,
                text: draft.text,
                normalizedText: normalized,
                relatedEntities: draft.relatedEntities ? [...draft.relatedEntities] : [],
                tags: draft.tags ? [...draft.tags] : [],
                reason: draft.reason,
                status,
                schemaVersion,
                createdAt: now,
                updatedAt: now,
            });
        }

        await this.db.transaction(async (tx) => {
            await tx.insert(memoryCandidates).values(rows);
        });
        return records;
    }

    async listCandidates(input: ListMemoryCandidatesInput): Promise<MemoryCandidateRecord[]> {
        const conditions = [eq(memoryCandidates.userId, input.userId)];
        if (input.characterId !== undefined) {
            conditions.push(eq(memoryCandidates.characterId, input.characterId));
        }
        if (input.conversationId !== undefined) {
            conditions.push(eq(memoryCandidates.conversationId, input.conversationId));
        }
        if (input.assistantMessageId !== undefined) {
            conditions.push(eq(memoryCandidates.assistantMessageId, input.assistantMessageId));
        }
        if (input.status !== undefined) {
            const statuses = Array.isArray(input.status) ? input.status : [input.status];
            if (statuses.length > 0) {
                conditions.push(inArray(memoryCandidates.status, statuses));
            }
        }

        // When the caller scoped to a single assistant turn we sort
        // by `seq` so candidates render in the order the model
        // emitted them; otherwise newest-first is the more useful
        // default for debug surfaces.
        const orderBy = input.assistantMessageId !== undefined
            ? [asc(memoryCandidates.seq)]
            : [desc(memoryCandidates.createdAt), asc(memoryCandidates.seq)];

        const baseQuery = this.db
            .select()
            .from(memoryCandidates)
            .where(and(...conditions))
            .orderBy(...orderBy);

        const rows = input.limit !== undefined
            ? await baseQuery.limit(input.limit)
            : await baseQuery;
        return rows.map((row) => this.rowToRecord(row));
    }

    async updateCandidateStatus(input: UpdateMemoryCandidateStatusInput): Promise<void> {
        const patch: Partial<MemoryCandidateRow> = {
            status: input.status,
            updatedAt: input.updatedAt,
        };
        // `reason` is sticky: callers either set it explicitly on a
        // failure transition or leave it untouched. We forward
        // `undefined` as "no change" and an empty string as "clear",
        // matching the in-memory fake's behaviour so commit-service
        // tests cover both implementations identically.
        if (input.reason !== undefined) {
            patch.reason = input.reason || null;
        }
        await this.db
            .update(memoryCandidates)
            .set(patch)
            .where(eq(memoryCandidates.id, input.candidateId));
    }

    async saveCandidateEmbedding(input: SaveCandidateEmbeddingInput): Promise<void> {
        const embeddingJson = JSON.stringify(input.embedding);
        await this.db
            .update(memoryCandidates)
            .set({
                embeddingJson,
                status: "embedded",
                updatedAt: input.updatedAt,
            })
            .where(eq(memoryCandidates.id, input.candidateId));
    }

    private async getNextSeq(
        userId: string,
        conversationId: string,
        assistantMessageId: string,
    ): Promise<number> {
        const rows = await this.db
            .select({ seq: memoryCandidates.seq })
            .from(memoryCandidates)
            .where(and(
                eq(memoryCandidates.userId, userId),
                eq(memoryCandidates.conversationId, conversationId),
                eq(memoryCandidates.assistantMessageId, assistantMessageId),
            ))
            .orderBy(desc(memoryCandidates.seq))
            .limit(1);
        if (rows.length === 0) return 0;
        return (rows[0]!.seq ?? -1) + 1;
    }

    private rowToRecord(row: MemoryCandidateRow): MemoryCandidateRecord {
        const relatedEntities = parseJsonArray(row.relatedEntitiesJson, this.logger, "memory_candidates.related_entities_json", row.id);
        const tags = parseJsonArray(row.tagsJson, this.logger, "memory_candidates.tags_json", row.id);
        const embedding = parseEmbeddingJson(row.embeddingJson, this.logger, "memory_candidates.embedding_json", row.id);
        return {
            id: row.id,
            source: {
                userId: row.userId,
                characterId: row.characterId,
                conversationId: row.conversationId,
                userMessageId: row.userMessageId,
                assistantMessageId: row.assistantMessageId,
                requestId: row.requestId,
                modelCallPurpose: row.modelCallPurpose,
            },
            seq: row.seq,
            scope: row.scope as MemoryCandidateRecord["scope"],
            type: row.type as MemoryCandidateRecord["type"],
            text: row.text,
            normalizedText: row.normalizedText,
            relatedEntities,
            tags,
            reason: row.reason ?? undefined,
            status: row.status as MemoryCandidateStatus,
            embedding,
            schemaVersion: row.schemaVersion,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
        };
    }
}

/**
 * Parse a JSON array column. Returns `[]` on any failure and warns
 * via `logger` so corrupted rows surface in operations logs without
 * breaking the read path. Exported helpers (one per shape) keep all
 * three memory stores consistent.
 */
export function parseJsonArray(
    raw: string | null,
    logger: MemoryLogger | undefined,
    columnLabel: string,
    rowId: string,
): string[] {
    if (!raw) return [];
    try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
            return parsed.filter((entry): entry is string => typeof entry === "string");
        }
    } catch (error) {
        logger?.warn("memory.sqlite.json_parse_failed", {
            column: columnLabel,
            rowId,
            message: error instanceof Error ? error.message : String(error),
        });
    }
    return [];
}

/**
 * Parse a stored {@link MemoryEmbedding} JSON blob. Returns
 * `undefined` (not `null`) when the column is empty, malformed, or
 * missing required fields; the commit service then treats the
 * memory as having no embedding and routes it through the
 * `noEmbedding` skip branch. We deliberately accept partial blobs
 * here: a corrupt row should never throw on read.
 */
export function parseEmbeddingJson(
    raw: string | null,
    logger: MemoryLogger | undefined,
    columnLabel: string,
    rowId: string,
): MemoryEmbedding | undefined {
    if (!raw) return undefined;
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch (error) {
        logger?.warn("memory.sqlite.json_parse_failed", {
            column: columnLabel,
            rowId,
            message: error instanceof Error ? error.message : String(error),
        });
        return undefined;
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        logger?.warn("memory.sqlite.embedding_shape_invalid", { column: columnLabel, rowId });
        return undefined;
    }
    const obj = parsed as Record<string, unknown>;
    const vector = obj.vector;
    if (!Array.isArray(vector) || !vector.every((v) => typeof v === "number")) {
        logger?.warn("memory.sqlite.embedding_vector_invalid", { column: columnLabel, rowId });
        return undefined;
    }
    if (
        typeof obj.provider !== "string"
        || typeof obj.model !== "string"
        || typeof obj.dim !== "number"
        || typeof obj.version !== "number"
        || typeof obj.createdAt !== "string"
    ) {
        logger?.warn("memory.sqlite.embedding_signature_invalid", { column: columnLabel, rowId });
        return undefined;
    }
    return {
        vector: vector as number[],
        provider: obj.provider,
        model: obj.model,
        dim: obj.dim,
        version: obj.version,
        createdAt: obj.createdAt,
    };
}
