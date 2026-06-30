import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { memoryRetained, type MemoryRetainedRow } from "./schema.js";
import type { DrizzleDb } from "./openDatabase.js";
import { parseEmbeddingJson, parseJsonArray } from "./SQLiteMemoryCandidateStore.js";
import type {
    ArchiveMemoryRetainedInput,
    CreateMemoryRetainedInput,
    ListMemoryRetainedInput,
    MemoryLogger,
    MemoryRetainedRecord,
    MemoryRetainedStatus,
    MemoryRetainedStore,
    UpdateMemoryRetainedInput,
} from "@ss-ai/persona-flow";

/**
 * SQLite-backed implementation of {@link MemoryRetainedStore}.
 *
 * Batch 3.5 ships the read-only `list` operation only. The table
 * is empty until the Batch 4 consolidation pass starts promoting
 * staging rows; this adapter exists now so the debug surface, the
 * AppStores wiring, and the eventual writer have a stable contract
 * to land against.
 */
export class SQLiteMemoryRetainedStore implements MemoryRetainedStore {
    private readonly db: DrizzleDb;
    private readonly logger?: MemoryLogger;

    constructor(deps: {
        db: DrizzleDb;
        logger?: MemoryLogger;
    }) {
        this.db = deps.db;
        this.logger = deps.logger;
    }

    async list(input: ListMemoryRetainedInput): Promise<MemoryRetainedRecord[]> {
        const conditions = [
            eq(memoryRetained.userId, input.userId),
            eq(memoryRetained.characterId, input.characterId),
        ];

        if (input.scope !== undefined) {
            const scopes = Array.isArray(input.scope) ? input.scope : [input.scope];
            if (scopes.length > 0) conditions.push(inArray(memoryRetained.scope, scopes));
        }
        if (input.type !== undefined) {
            const types = Array.isArray(input.type) ? input.type : [input.type];
            if (types.length > 0) conditions.push(inArray(memoryRetained.type, types));
        }
        if (input.status !== undefined) {
            const statuses = Array.isArray(input.status) ? input.status : [input.status];
            if (statuses.length > 0) conditions.push(inArray(memoryRetained.status, statuses));
        }

        // Deterministic order before any truncation: newest first
        // by updatedAt, then createdAt, then id as a tiebreaker.
        const baseQuery = this.db
            .select()
            .from(memoryRetained)
            .where(and(...conditions))
            .orderBy(desc(memoryRetained.updatedAt), desc(memoryRetained.createdAt), asc(memoryRetained.id));
        const rows = input.limit !== undefined ? await baseQuery.limit(input.limit) : await baseQuery;
        return rows.map((row) => this.rowToRecord(row));
    }

    async create(input: CreateMemoryRetainedInput): Promise<MemoryRetainedRecord> {
        const [row] = await this.db
            .insert(memoryRetained)
            .values({
                id: input.id,
                userId: input.userId,
                characterId: input.characterId,
                scope: input.scope,
                type: input.type,
                text: input.text,
                normalizedText: input.normalizedText,
                relatedEntitiesJson: JSON.stringify(input.relatedEntities),
                tagsJson: JSON.stringify(input.tags),
                sourceStagingId: input.sourceStagingId ?? null,
                status: input.status,
                importance: input.importance,
                occurrenceCount: input.occurrenceCount,
                firstSeenAt: input.firstSeenAt,
                lastSeenAt: input.lastSeenAt,
                embeddingJson: input.embedding ? JSON.stringify(input.embedding) : null,
                schemaVersion: 1,
                createdAt: input.now,
                updatedAt: input.now,
            })
            .returning();
        return this.rowToRecord(row);
    }

    async update(input: UpdateMemoryRetainedInput): Promise<MemoryRetainedRecord> {
        const patch: Record<string, unknown> = { updatedAt: input.updatedAt };
        if (input.text !== undefined) patch.text = input.text;
        if (input.normalizedText !== undefined) patch.normalizedText = input.normalizedText;
        if (input.relatedEntities !== undefined) patch.relatedEntitiesJson = JSON.stringify(input.relatedEntities);
        if (input.tags !== undefined) patch.tagsJson = JSON.stringify(input.tags);
        if (input.sourceStagingId !== undefined) patch.sourceStagingId = input.sourceStagingId;
        if (input.importance !== undefined) patch.importance = input.importance;
        if (input.lastSeenAt !== undefined) patch.lastSeenAt = input.lastSeenAt;
        if (input.embedding !== undefined) patch.embeddingJson = JSON.stringify(input.embedding);
        if (input.occurrenceDelta) {
            patch.occurrenceCount = sql`${memoryRetained.occurrenceCount} + ${input.occurrenceDelta}`;
        }
        const [row] = await this.db
            .update(memoryRetained)
            .set(patch)
            .where(eq(memoryRetained.id, input.memoryRetainedId))
            .returning();
        return this.rowToRecord(row);
    }

    async archive(input: ArchiveMemoryRetainedInput): Promise<void> {
        await this.db
            .update(memoryRetained)
            .set({ status: "archived", updatedAt: input.updatedAt })
            .where(eq(memoryRetained.id, input.memoryRetainedId));
    }

    private rowToRecord(row: MemoryRetainedRow): MemoryRetainedRecord {
        return {
            id: row.id,
            userId: row.userId,
            characterId: row.characterId,
            scope: row.scope as MemoryRetainedRecord["scope"],
            type: row.type as MemoryRetainedRecord["type"],
            text: row.text,
            normalizedText: row.normalizedText,
            relatedEntities: parseJsonArray(row.relatedEntitiesJson, this.logger, "memory_retained.related_entities_json", row.id),
            tags: parseJsonArray(row.tagsJson, this.logger, "memory_retained.tags_json", row.id),
            sourceStagingId: row.sourceStagingId ?? undefined,
            status: row.status as MemoryRetainedStatus,
            importance: row.importance,
            occurrenceCount: row.occurrenceCount,
            firstSeenAt: row.firstSeenAt,
            lastSeenAt: row.lastSeenAt,
            embedding: parseEmbeddingJson(row.embeddingJson, this.logger, "memory_retained.embedding_json", row.id),
            schemaVersion: row.schemaVersion,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
        };
    }
}
