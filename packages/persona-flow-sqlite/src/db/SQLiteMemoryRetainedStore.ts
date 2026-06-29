import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { memoryRetained, type MemoryRetainedRow } from "./schema.js";
import type { DrizzleDb } from "./openDatabase.js";
import { parseEmbeddingJson, parseJsonArray } from "./SQLiteMemoryCandidateStore.js";
import type {
    ListMemoryRetainedInput,
    MemoryLogger,
    MemoryRetainedRecord,
    MemoryRetainedStatus,
    MemoryRetainedStore,
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
            embedding: parseEmbeddingJson(row.embeddingJson, this.logger, "memory_retained.embedding_json", row.id),
            schemaVersion: row.schemaVersion,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
        };
    }
}
