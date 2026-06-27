import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { memories, type MemoryRow, type NewMemoryRow } from "./schema.js";
import type { DrizzleDb } from "./openDatabase.js";
import { parseEmbeddingJson, parseJsonArray } from "./SQLiteMemoryCandidateStore.js";
import type {
    ActiveMemoryRecord,
    CreateMemoryInput,
    FindExactActiveMemoryInput,
    ListActiveMemoriesInput,
    MemoryIdGenerator,
    MemoryLogger,
    MemoryStatus,
    MemoryStore,
    SaveMemoryEmbeddingInput,
} from "@ss-ai/persona-flow";

/**
 * SQLite-backed implementation of {@link MemoryStore}.
 *
 * Every memory belongs to exactly one character world. `character_id`
 * is `NOT NULL` and acts as the isolation key for `listActiveMemories`,
 * `findExactActiveMemory`, and `createMemory` alike. `scope` only
 * classifies the memory inside that world (`user`, `character`,
 * `relationship`, `conversation`, `world`); it never makes a memory
 * cross characters.
 *
 * Important atomicity caveat: `createMemory` only inserts the
 * memory row. The commit pipeline still issues `appendDecision`
 * and `updateCandidateStatus` as separate calls afterwards, so a
 * crash between them can leave an orphan memory without its
 * decision row. That gap is intentional for Step 5 — the
 * follow-up to introduce a `MemoryCommitGateway` with composite
 * transactional methods is tracked in `docs/todo.md`.
 */
export class SQLiteMemoryStore implements MemoryStore {
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

    async createMemory(input: CreateMemoryInput): Promise<ActiveMemoryRecord> {
        const id = this.ids.randomId();
        const status: MemoryStatus = "active";
        const schemaVersion = 1;
        const row: NewMemoryRow = {
            id,
            userId: input.userId,
            characterId: input.characterId,
            scope: input.scope,
            type: input.type,
            text: input.text,
            normalizedText: input.normalizedText,
            relatedEntitiesJson: JSON.stringify(input.relatedEntities ?? []),
            tagsJson: JSON.stringify(input.tags ?? []),
            sourceCandidateId: input.sourceCandidateId ?? null,
            sourceConversationId: input.sourceConversationId ?? null,
            sourceUserMessageId: input.sourceUserMessageId ?? null,
            sourceAssistantMessageId: input.sourceAssistantMessageId ?? null,
            status,
            importance: input.importance,
            embeddingJson: input.embedding ? JSON.stringify(input.embedding) : null,
            schemaVersion,
            createdAt: input.createdAt,
            updatedAt: input.updatedAt,
        };
        await this.db.insert(memories).values(row);
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
            sourceCandidateId: input.sourceCandidateId,
            sourceConversationId: input.sourceConversationId,
            sourceUserMessageId: input.sourceUserMessageId,
            sourceAssistantMessageId: input.sourceAssistantMessageId,
            status,
            importance: input.importance,
            embedding: input.embedding,
            schemaVersion,
            createdAt: input.createdAt,
            updatedAt: input.updatedAt,
        };
    }

    async listActiveMemories(input: ListActiveMemoriesInput): Promise<ActiveMemoryRecord[]> {
        const conditions = [
            eq(memories.userId, input.userId),
            eq(memories.characterId, input.characterId),
        ];

        if (input.scope !== undefined) {
            const scopes = Array.isArray(input.scope) ? input.scope : [input.scope];
            if (scopes.length > 0) conditions.push(inArray(memories.scope, scopes));
        }
        if (input.type !== undefined) {
            const types = Array.isArray(input.type) ? input.type : [input.type];
            if (types.length > 0) conditions.push(inArray(memories.type, types));
        }
        if (input.status !== undefined) {
            const statuses = Array.isArray(input.status) ? input.status : [input.status];
            if (statuses.length > 0) conditions.push(inArray(memories.status, statuses));
        }

        // Deterministic order before any truncation: newest first
        // by updatedAt, then createdAt, then id as a tiebreaker.
        // The `MemoryStore.listActiveMemories` port contract
        // requires this so callers (notably the commit service's
        // similarity scan) get a stable subset whenever a bucket
        // exceeds `limit`.
        const baseQuery = this.db
            .select()
            .from(memories)
            .where(and(...conditions))
            .orderBy(desc(memories.updatedAt), desc(memories.createdAt), asc(memories.id));
        const rows = input.limit !== undefined ? await baseQuery.limit(input.limit) : await baseQuery;
        return rows.map((row) => this.rowToRecord(row));
    }

    async findExactActiveMemory(input: FindExactActiveMemoryInput): Promise<ActiveMemoryRecord | undefined> {
        const conditions = [
            eq(memories.userId, input.userId),
            eq(memories.characterId, input.characterId),
            eq(memories.scope, input.scope),
            eq(memories.type, input.type),
            eq(memories.normalizedText, input.normalizedText),
            eq(memories.status, "active"),
        ];

        const rows = await this.db
            .select()
            .from(memories)
            .where(and(...conditions))
            .limit(1);
        return rows.length === 0 ? undefined : this.rowToRecord(rows[0]!);
    }

    async saveMemoryEmbedding(input: SaveMemoryEmbeddingInput): Promise<void> {
        await this.db
            .update(memories)
            .set({
                embeddingJson: JSON.stringify(input.embedding),
                updatedAt: input.updatedAt,
            })
            .where(eq(memories.id, input.memoryId));
    }

    private rowToRecord(row: MemoryRow): ActiveMemoryRecord {
        return {
            id: row.id,
            userId: row.userId,
            characterId: row.characterId,
            scope: row.scope as ActiveMemoryRecord["scope"],
            type: row.type as ActiveMemoryRecord["type"],
            text: row.text,
            normalizedText: row.normalizedText,
            relatedEntities: parseJsonArray(row.relatedEntitiesJson, this.logger, "memories.related_entities_json", row.id),
            tags: parseJsonArray(row.tagsJson, this.logger, "memories.tags_json", row.id),
            sourceCandidateId: row.sourceCandidateId ?? undefined,
            sourceConversationId: row.sourceConversationId ?? undefined,
            sourceUserMessageId: row.sourceUserMessageId ?? undefined,
            sourceAssistantMessageId: row.sourceAssistantMessageId ?? undefined,
            status: row.status as MemoryStatus,
            importance: row.importance,
            embedding: parseEmbeddingJson(row.embeddingJson, this.logger, "memories.embedding_json", row.id),
            schemaVersion: row.schemaVersion,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
        };
    }
}
