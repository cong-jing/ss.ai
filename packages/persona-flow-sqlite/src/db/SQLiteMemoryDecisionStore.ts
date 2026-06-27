import { and, desc, eq, inArray } from "drizzle-orm";
import { memoryDecisions, type MemoryDecisionRow, type NewMemoryDecisionRow } from "./schema.js";
import type { DrizzleDb } from "./openDatabase.js";
import type {
    AppendMemoryDecisionInput,
    ListMemoryDecisionsInput,
    MemoryDecisionKind,
    MemoryDecisionRecord,
    MemoryDecisionStore,
    MemoryIdGenerator,
    MemoryLogger,
    MemorySimilaritySummaryEntry,
} from "@ss-ai/persona-flow";

/**
 * SQLite-backed implementation of {@link MemoryDecisionStore}.
 *
 * Append-only audit trail: one row per commit-service decision per
 * candidate. The top-K similarity summary is persisted as JSON so
 * later debug surfaces can rebuild the reasoning without re-running
 * any embedding requests. Reads recover from a malformed
 * `similarity_json` blob by returning an empty array and warning
 * via `logger`; this matches `parseEmbeddingJson` semantics on the
 * sibling stores and keeps the read path crash-free.
 */
export class SQLiteMemoryDecisionStore implements MemoryDecisionStore {
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

    async appendDecision(input: AppendMemoryDecisionInput): Promise<MemoryDecisionRecord> {
        const id = this.ids.randomId();
        const row: NewMemoryDecisionRow = {
            id,
            candidateId: input.candidateId,
            userId: input.userId,
            characterId: input.characterId,
            decision: input.decision,
            memoryId: input.memoryId ?? null,
            reason: input.reason ?? null,
            similarityJson: JSON.stringify(input.similarity ?? []),
            policyVersion: input.policyVersion,
            createdAt: input.createdAt,
        };
        await this.db.insert(memoryDecisions).values(row);
        return {
            id,
            candidateId: input.candidateId,
            userId: input.userId,
            characterId: input.characterId,
            decision: input.decision,
            memoryId: input.memoryId,
            reason: input.reason,
            similarity: input.similarity ? input.similarity.map((s) => ({ ...s })) : [],
            policyVersion: input.policyVersion,
            createdAt: input.createdAt,
        };
    }

    async listDecisions(input: ListMemoryDecisionsInput): Promise<MemoryDecisionRecord[]> {
        const conditions = [eq(memoryDecisions.userId, input.userId)];
        if (input.candidateId !== undefined) {
            conditions.push(eq(memoryDecisions.candidateId, input.candidateId));
        }
        if (input.decision !== undefined) {
            const kinds = Array.isArray(input.decision) ? input.decision : [input.decision];
            if (kinds.length > 0) conditions.push(inArray(memoryDecisions.decision, kinds));
        }

        const baseQuery = this.db
            .select()
            .from(memoryDecisions)
            .where(and(...conditions))
            .orderBy(desc(memoryDecisions.createdAt));

        const rows = input.limit !== undefined ? await baseQuery.limit(input.limit) : await baseQuery;
        return rows.map((row) => this.rowToRecord(row));
    }

    private rowToRecord(row: MemoryDecisionRow): MemoryDecisionRecord {
        return {
            id: row.id,
            candidateId: row.candidateId,
            userId: row.userId,
            characterId: row.characterId,
            decision: row.decision as MemoryDecisionKind,
            memoryId: row.memoryId ?? undefined,
            reason: row.reason ?? undefined,
            similarity: parseSimilarityJson(row.similarityJson, this.logger, row.id),
            policyVersion: row.policyVersion,
            createdAt: row.createdAt,
        };
    }
}

function parseSimilarityJson(
    raw: string,
    logger: MemoryLogger | undefined,
    rowId: string,
): MemorySimilaritySummaryEntry[] {
    if (!raw) return [];
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch (error) {
        logger?.warn("memory.sqlite.json_parse_failed", {
            column: "memory_decisions.similarity_json",
            rowId,
            message: error instanceof Error ? error.message : String(error),
        });
        return [];
    }
    if (!Array.isArray(parsed)) return [];
    const out: MemorySimilaritySummaryEntry[] = [];
    for (const entry of parsed) {
        if (
            entry
            && typeof entry === "object"
            && !Array.isArray(entry)
            && typeof (entry as Record<string, unknown>).memoryId === "string"
            && typeof (entry as Record<string, unknown>).similarity === "number"
            && typeof (entry as Record<string, unknown>).text === "string"
        ) {
            const e = entry as Record<string, unknown>;
            out.push({
                memoryId: e.memoryId as string,
                similarity: e.similarity as number,
                text: e.text as string,
            });
        }
    }
    return out;
}
