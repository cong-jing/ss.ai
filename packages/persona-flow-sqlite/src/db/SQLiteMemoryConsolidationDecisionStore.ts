import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { memoryConsolidationDecisions, type MemoryConsolidationDecisionRow } from "./schema.js";
import type { DrizzleDb } from "./openDatabase.js";
import type { MemoryLogger } from "@ss-ai/persona-flow";
import type {
    ConsolidationDecisionRecord,
    CreateConsolidationDecisionInput,
    FindAppliedDecisionInput,
    ListConsolidationDecisionsInput,
    MemoryConsolidationDecisionStore,
} from "@ss-ai/persona-flow";

/**
 * SQLite-backed audit store for the Batch 4 consolidation judge.
 *
 * The partial unique index on `(memory_staging_id) WHERE status =
 * 'applied'` enforces the idempotency invariant; `findApplied` lets
 * the processor short-circuit a staging row that was already
 * consolidated in a prior run.
 */
export class SQLiteMemoryConsolidationDecisionStore implements MemoryConsolidationDecisionStore {
    private readonly db: DrizzleDb;
    private readonly logger?: MemoryLogger;

    constructor(deps: { db: DrizzleDb; logger?: MemoryLogger }) {
        this.db = deps.db;
        this.logger = deps.logger;
    }

    async create(input: CreateConsolidationDecisionInput): Promise<ConsolidationDecisionRecord> {
        const [row] = await this.db
            .insert(memoryConsolidationDecisions)
            .values({
                id: input.id,
                userId: input.userId,
                characterId: input.characterId,
                memoryStagingId: input.memoryStagingId,
                action: input.action,
                targetRetainedMemoryId: input.targetRetainedMemoryId ?? null,
                createdRetainedMemoryId: input.createdRetainedMemoryId ?? null,
                archivedRetainedMemoryIdsJson: JSON.stringify(input.archivedRetainedMemoryIds),
                judgeRequestJson: input.judgeRequest !== undefined ? JSON.stringify(input.judgeRequest) : null,
                judgeResponseJson: input.judgeResponse !== undefined ? JSON.stringify(input.judgeResponse) : null,
                validatedActionJson: input.validatedAction !== undefined ? JSON.stringify(input.validatedAction) : null,
                status: input.status,
                statusReason: input.statusReason ?? null,
                modelCallPurpose: input.modelCallPurpose,
                model: input.model ?? null,
                requestId: input.requestId ?? null,
                createdAt: input.createdAt,
            })
            .returning();
        return this.rowToRecord(row);
    }

    async findApplied(input: FindAppliedDecisionInput): Promise<ConsolidationDecisionRecord | undefined> {
        const rows = await this.db
            .select()
            .from(memoryConsolidationDecisions)
            .where(and(
                eq(memoryConsolidationDecisions.memoryStagingId, input.memoryStagingId),
                eq(memoryConsolidationDecisions.status, "applied"),
            ))
            .limit(1);
        return rows.length ? this.rowToRecord(rows[0]!) : undefined;
    }

    async list(input: ListConsolidationDecisionsInput): Promise<ConsolidationDecisionRecord[]> {
        const conditions = [eq(memoryConsolidationDecisions.userId, input.userId)];
        if (input.characterId !== undefined) {
            conditions.push(eq(memoryConsolidationDecisions.characterId, input.characterId));
        }
        if (input.memoryStagingId !== undefined) {
            conditions.push(eq(memoryConsolidationDecisions.memoryStagingId, input.memoryStagingId));
        }
        if (input.action !== undefined) {
            const actions = Array.isArray(input.action) ? input.action : [input.action];
            if (actions.length > 0) conditions.push(inArray(memoryConsolidationDecisions.action, actions));
        }
        if (input.status !== undefined) {
            const statuses = Array.isArray(input.status) ? input.status : [input.status];
            if (statuses.length > 0) conditions.push(inArray(memoryConsolidationDecisions.status, statuses));
        }
        const baseQuery = this.db
            .select()
            .from(memoryConsolidationDecisions)
            .where(and(...conditions))
            .orderBy(desc(memoryConsolidationDecisions.createdAt), asc(memoryConsolidationDecisions.id));
        const rows = input.limit !== undefined ? await baseQuery.limit(input.limit) : await baseQuery;
        return rows.map((row) => this.rowToRecord(row));
    }

    private rowToRecord(row: MemoryConsolidationDecisionRow): ConsolidationDecisionRecord {
        return {
            id: row.id,
            userId: row.userId,
            characterId: row.characterId,
            memoryStagingId: row.memoryStagingId,
            action: row.action as ConsolidationDecisionRecord["action"],
            targetRetainedMemoryId: row.targetRetainedMemoryId ?? undefined,
            createdRetainedMemoryId: row.createdRetainedMemoryId ?? undefined,
            archivedRetainedMemoryIds: this.parseIds(row.archivedRetainedMemoryIdsJson, row.id),
            judgeRequest: this.parseJson(row.judgeRequestJson),
            judgeResponse: this.parseJson(row.judgeResponseJson),
            validatedAction: this.parseJson(row.validatedActionJson),
            status: row.status as ConsolidationDecisionRecord["status"],
            statusReason: row.statusReason ?? undefined,
            modelCallPurpose: row.modelCallPurpose,
            model: row.model ?? undefined,
            requestId: row.requestId ?? undefined,
            createdAt: row.createdAt,
        };
    }

    private parseIds(json: string, id: string): string[] {
        try {
            const value = JSON.parse(json);
            return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
        } catch {
            this.logger?.warn("memory.sqlite.consolidation_ids_parse_failed", { id });
            return [];
        }
    }

    private parseJson(json: string | null): unknown {
        if (json === null) return undefined;
        try {
            return JSON.parse(json);
        } catch {
            return undefined;
        }
    }
}
