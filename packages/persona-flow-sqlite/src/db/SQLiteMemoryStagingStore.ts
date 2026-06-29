import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import {
    memoryStaging,
    memoryStagingSources,
    type MemoryStagingRow,
    type MemoryStagingSourceRow,
    type NewMemoryStagingRow,
    type NewMemoryStagingSourceRow,
} from "./schema.js";
import type { DrizzleDb } from "./openDatabase.js";
import { parseEmbeddingJson, parseJsonArray } from "./SQLiteMemoryCandidateStore.js";
import type {
    CreateMemoryStagingInput,
    FindBySourceCandidateInput,
    FindExactStagingInput,
    IncrementMemoryStagingOccurrenceInput,
    LinkStagingSourceInput,
    ListMemoryStagingInput,
    MemoryIdGenerator,
    MemoryLogger,
    MemoryStagingRecord,
    MemoryStagingSourceRecord,
    MemoryStagingStatus,
    MemoryStagingStore,
} from "@ss-ai/persona-flow";

/**
 * SQLite-backed implementation of {@link MemoryStagingStore}.
 *
 * Owns two tables:
 *  - `memory_staging` — the aggregated staging row.
 *  - `memory_staging_sources` — the candidate-to-staging link rows
 *    (UNIQUE on `candidate_id` so a single candidate can only
 *    contribute once).
 *
 * Atomicity:
 *  - `create` wraps the staging insert + first link in a single
 *    transaction so a crash midway never produces an orphan
 *    staging row.
 *  - `linkSource` is a single row insert; the UNIQUE constraint
 *    on `candidate_id` guarantees idempotency: a duplicate insert
 *    raises a constraint error which the staging processor maps
 *    onto its "already linked" branch via `findBySourceCandidate`.
 *  - `incrementOccurrence` is a single `UPDATE` so it runs as one
 *    transaction in SQLite by default.
 *
 * JSON-shape failures on read are swallowed via `parseJsonArray` /
 * `parseEmbeddingJson` (which warn through `logger`) so corrupt rows
 * never break the read path.
 */
export class SQLiteMemoryStagingStore implements MemoryStagingStore {
    private readonly db: DrizzleDb;
    private readonly ids: MemoryIdGenerator;
    private readonly logger?: MemoryLogger;

    constructor(deps: {
        db: DrizzleDb;
        ids: MemoryIdGenerator;
        logger?: MemoryLogger;
    }) {
        this.db = deps.db;
        this.ids = deps.ids;
        this.logger = deps.logger;
    }

    async findBySourceCandidate(input: FindBySourceCandidateInput): Promise<MemoryStagingRecord | undefined> {
        const linkRows = await this.db
            .select()
            .from(memoryStagingSources)
            .where(eq(memoryStagingSources.candidateId, input.candidateId))
            .limit(1);
        if (linkRows.length === 0) return undefined;
        const stagingId = linkRows[0]!.memoryStagingId;
        const stagingRows = await this.db
            .select()
            .from(memoryStaging)
            .where(eq(memoryStaging.id, stagingId))
            .limit(1);
        if (stagingRows.length === 0) {
            // Dangling link row. Treat as "no aggregation" so the
            // processor falls back to the create path; the
            // mismatched link is surfaced for ops via the logger.
            this.logger?.warn("memory.sqlite.staging_link_orphan", {
                candidateId: input.candidateId,
                memoryStagingId: stagingId,
            });
            return undefined;
        }
        return this.rowToRecord(stagingRows[0]!);
    }

    async findExact(input: FindExactStagingInput): Promise<MemoryStagingRecord | undefined> {
        const rows = await this.db
            .select()
            .from(memoryStaging)
            .where(and(
                eq(memoryStaging.userId, input.userId),
                eq(memoryStaging.characterId, input.characterId),
                eq(memoryStaging.scope, input.scope),
                eq(memoryStaging.type, input.type),
                eq(memoryStaging.normalizedText, input.normalizedText),
            ))
            .orderBy(asc(memoryStaging.createdAt), asc(memoryStaging.id))
            .limit(1);
        if (rows.length === 0) return undefined;
        return this.rowToRecord(rows[0]!);
    }

    async create(input: CreateMemoryStagingInput): Promise<MemoryStagingRecord> {
        const id = this.ids.randomId();
        const schemaVersion = 1;
        const stagingRow: NewMemoryStagingRow = {
            id,
            userId: input.userId,
            characterId: input.characterId,
            scope: input.scope,
            type: input.type,
            text: input.text,
            normalizedText: input.normalizedText,
            relatedEntitiesJson: JSON.stringify(input.relatedEntities ?? []),
            tagsJson: JSON.stringify(input.tags ?? []),
            status: input.status,
            statusReason: input.statusReason ?? null,
            occurrenceCount: 1,
            firstSeenAt: input.firstSeenAt,
            lastSeenAt: input.now,
            embeddingJson: input.embedding ? JSON.stringify(input.embedding) : null,
            schemaVersion,
            createdAt: input.now,
            updatedAt: input.now,
        };
        const sourceRow: NewMemoryStagingSourceRow = {
            memoryStagingId: id,
            candidateId: input.initialSource.candidateId,
            candidateSeq: input.initialSource.candidateSeq,
            createdAt: input.now,
        };

        await this.db.transaction(async (tx) => {
            await tx.insert(memoryStaging).values(stagingRow);
            await tx.insert(memoryStagingSources).values(sourceRow);
        });

        return {
            id,
            userId: input.userId,
            characterId: input.characterId,
            scope: input.scope,
            type: input.type,
            text: input.text,
            normalizedText: input.normalizedText,
            relatedEntities: input.relatedEntities ? [...input.relatedEntities] : [],
            tags: input.tags ? [...input.tags] : [],
            status: input.status,
            statusReason: input.statusReason,
            occurrenceCount: 1,
            firstSeenAt: input.firstSeenAt,
            lastSeenAt: input.now,
            embedding: input.embedding,
            schemaVersion,
            createdAt: input.now,
            updatedAt: input.now,
        };
    }

    async linkSource(input: LinkStagingSourceInput): Promise<MemoryStagingSourceRecord> {
        const row: NewMemoryStagingSourceRow = {
            memoryStagingId: input.memoryStagingId,
            candidateId: input.candidateId,
            candidateSeq: input.candidateSeq,
            createdAt: input.createdAt,
        };
        await this.db.insert(memoryStagingSources).values(row);
        return {
            memoryStagingId: input.memoryStagingId,
            candidateId: input.candidateId,
            candidateSeq: input.candidateSeq,
            createdAt: input.createdAt,
        };
    }

    async incrementOccurrence(input: IncrementMemoryStagingOccurrenceInput): Promise<MemoryStagingRecord> {
        // `occurrence_count + 1` inside the same UPDATE keeps the
        // increment atomic per row in SQLite. We then re-read so
        // the caller gets the post-update record.
        await this.db
            .update(memoryStaging)
            .set({
                occurrenceCount: sql`${memoryStaging.occurrenceCount} + 1`,
                lastSeenAt: input.lastSeenAt,
                updatedAt: input.updatedAt,
            })
            .where(eq(memoryStaging.id, input.memoryStagingId));

        const rows = await this.db
            .select()
            .from(memoryStaging)
            .where(eq(memoryStaging.id, input.memoryStagingId))
            .limit(1);
        if (rows.length === 0) {
            throw new Error(
                `SQLiteMemoryStagingStore.incrementOccurrence: staging row ${input.memoryStagingId} disappeared mid-update`,
            );
        }
        return this.rowToRecord(rows[0]!);
    }

    async list(input: ListMemoryStagingInput): Promise<MemoryStagingRecord[]> {
        if (input.sourceCandidateId !== undefined) {
            // Look up via the source link first so the join is
            // expressed as two cheap queries rather than a SQL JOIN
            // (Drizzle's join syntax adds noise that we do not need
            // for a debug endpoint).
            const link = await this.db
                .select()
                .from(memoryStagingSources)
                .where(eq(memoryStagingSources.candidateId, input.sourceCandidateId))
                .limit(1);
            if (link.length === 0) return [];
            const stagingId = link[0]!.memoryStagingId;
            const stagingRows = await this.db
                .select()
                .from(memoryStaging)
                .where(eq(memoryStaging.id, stagingId))
                .limit(1);
            // Apply the rest of the filters in-memory; this path is
            // only ever hit by the single-candidate debug query so
            // the cost is negligible.
            return stagingRows
                .map((row) => this.rowToRecord(row))
                .filter((record) => filterStagingRecord(record, input));
        }

        const conditions = [eq(memoryStaging.userId, input.userId)];
        if (input.characterId !== undefined) {
            conditions.push(eq(memoryStaging.characterId, input.characterId));
        }
        if (input.scope !== undefined) {
            const scopes = Array.isArray(input.scope) ? input.scope : [input.scope];
            if (scopes.length > 0) conditions.push(inArray(memoryStaging.scope, scopes));
        }
        if (input.type !== undefined) {
            const types = Array.isArray(input.type) ? input.type : [input.type];
            if (types.length > 0) conditions.push(inArray(memoryStaging.type, types));
        }
        if (input.status !== undefined) {
            const statuses = Array.isArray(input.status) ? input.status : [input.status];
            if (statuses.length > 0) conditions.push(inArray(memoryStaging.status, statuses));
        }

        const baseQuery = this.db
            .select()
            .from(memoryStaging)
            .where(and(...conditions))
            .orderBy(desc(memoryStaging.updatedAt), desc(memoryStaging.createdAt), asc(memoryStaging.id));
        const rows = input.limit !== undefined ? await baseQuery.limit(input.limit) : await baseQuery;
        return rows.map((row) => this.rowToRecord(row));
    }

    private rowToRecord(row: MemoryStagingRow): MemoryStagingRecord {
        return {
            id: row.id,
            userId: row.userId,
            characterId: row.characterId,
            scope: row.scope as MemoryStagingRecord["scope"],
            type: row.type as MemoryStagingRecord["type"],
            text: row.text,
            normalizedText: row.normalizedText,
            relatedEntities: parseJsonArray(row.relatedEntitiesJson, this.logger, "memory_staging.related_entities_json", row.id),
            tags: parseJsonArray(row.tagsJson, this.logger, "memory_staging.tags_json", row.id),
            status: row.status as MemoryStagingStatus,
            statusReason: row.statusReason ?? undefined,
            occurrenceCount: row.occurrenceCount,
            firstSeenAt: row.firstSeenAt,
            lastSeenAt: row.lastSeenAt,
            embedding: parseEmbeddingJson(row.embeddingJson, this.logger, "memory_staging.embedding_json", row.id),
            schemaVersion: row.schemaVersion,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
        };
    }
}

function filterStagingRecord(record: MemoryStagingRecord, input: ListMemoryStagingInput): boolean {
    if (record.userId !== input.userId) return false;
    if (input.characterId !== undefined && record.characterId !== input.characterId) return false;
    if (input.scope !== undefined) {
        const scopes = Array.isArray(input.scope) ? input.scope : [input.scope];
        if (scopes.length > 0 && !scopes.includes(record.scope)) return false;
    }
    if (input.type !== undefined) {
        const types = Array.isArray(input.type) ? input.type : [input.type];
        if (types.length > 0 && !types.includes(record.type)) return false;
    }
    if (input.status !== undefined) {
        const statuses = Array.isArray(input.status) ? input.status : [input.status];
        if (statuses.length > 0 && !statuses.includes(record.status)) return false;
    }
    return true;
}

// re-export type to keep imports tidy where needed
export type { MemoryStagingSourceRow };
