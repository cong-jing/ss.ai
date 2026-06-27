import type {
    ActiveMemoryRecord,
    AppendMemoryCandidatesInput,
    AppendMemoryDecisionInput,
    CreateMemoryInput,
    FindExactActiveMemoryInput,
    ListActiveMemoriesInput,
    ListMemoryCandidatesInput,
    ListMemoryDecisionsInput,
    MemoryCandidateRecord,
    MemoryCandidateStore,
    MemoryDecisionRecord,
    MemoryDecisionStore,
    MemoryStore,
    SaveCandidateEmbeddingInput,
    SaveMemoryEmbeddingInput,
    UpdateMemoryCandidateStatusInput,
} from "@ss-ai/persona-flow";

/**
 * In-memory memory stores for HTTP integration tests.
 *
 * These satisfy the `AppStores` interface and keep enough state for
 * the Step 7 debug API tests (and any future server tests that need
 * to read back candidate / memory / decision rows).
 *
 * They do NOT implement the commit-pipeline mutations
 * (`updateCandidateStatus`, `saveCandidateEmbedding`,
 * `findExactActiveMemory`, `saveMemoryEmbedding`) beyond what's
 * needed to keep types happy, because the chat-turn → commit
 * service path is exercised against the richer
 * `makeInMemoryMemoryStores()` fakes inside `@ss-ai/persona-flow`
 * test helpers, not through the HTTP boundary.
 */

let nextId = 0;
function makeId(): string {
    nextId += 1;
    return `mem-stub-${nextId}`;
}

function toArray<T extends string>(value: T | T[] | undefined): T[] {
    if (value === undefined) return [];
    return Array.isArray(value) ? value : [value];
}

function applyLimit<T>(rows: T[], limit: number | undefined): T[] {
    if (limit === undefined) return rows;
    if (!Number.isFinite(limit) || limit <= 0) return [];
    return rows.slice(0, Math.floor(limit));
}

export class StubMemoryCandidateStore implements MemoryCandidateStore {
    readonly rows: MemoryCandidateRecord[] = [];
    private seqByTurn = new Map<string, number>();

    async appendCandidates(input: AppendMemoryCandidatesInput): Promise<MemoryCandidateRecord[]> {
        const now = new Date().toISOString();
        const turnKey = `${input.source.assistantMessageId}`;
        const startSeq = this.seqByTurn.get(turnKey) ?? 0;
        const added: MemoryCandidateRecord[] = [];
        for (let i = 0; i < input.candidates.length; i += 1) {
            const draft = input.candidates[i]!;
            const normalized = input.normalizedTexts[i]!;
            const record: MemoryCandidateRecord = {
                id: makeId(),
                source: { ...input.source },
                seq: startSeq + i,
                scope: draft.scope,
                type: draft.type,
                text: draft.text,
                normalizedText: normalized,
                relatedEntities: draft.relatedEntities ? [...draft.relatedEntities] : [],
                tags: draft.tags ? [...draft.tags] : [],
                reason: draft.reason,
                status: "pending",
                schemaVersion: 1,
                createdAt: now,
                updatedAt: now,
            };
            this.rows.push(record);
            added.push(record);
        }
        this.seqByTurn.set(turnKey, startSeq + input.candidates.length);
        return added.map((record) => ({ ...record, source: { ...record.source } }));
    }

    async listCandidates(input: ListMemoryCandidatesInput): Promise<MemoryCandidateRecord[]> {
        const statusFilter = toArray(input.status);
        const filtered = this.rows
            .filter((r) => r.source.userId === input.userId)
            .filter((r) => input.characterId === undefined || r.source.characterId === input.characterId)
            .filter((r) => input.conversationId === undefined || r.source.conversationId === input.conversationId)
            .filter((r) => input.assistantMessageId === undefined || r.source.assistantMessageId === input.assistantMessageId)
            .filter((r) => statusFilter.length === 0 || statusFilter.includes(r.status))
            .slice()
            .sort((a, b) => {
                if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
                return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
            });
        return applyLimit(filtered, input.limit).map((r) => ({ ...r, source: { ...r.source } }));
    }

    async updateCandidateStatus(_input: UpdateMemoryCandidateStatusInput): Promise<void> { /* no-op */ }
    async saveCandidateEmbedding(_input: SaveCandidateEmbeddingInput): Promise<void> { /* no-op */ }
}

export class StubMemoryStore implements MemoryStore {
    readonly rows: ActiveMemoryRecord[] = [];

    async createMemory(input: CreateMemoryInput): Promise<ActiveMemoryRecord> {
        const record: ActiveMemoryRecord = {
            id: makeId(),
            userId: input.userId,
            characterId: input.characterId,
            scope: input.scope,
            type: input.type,
            text: input.text,
            normalizedText: input.normalizedText,
            relatedEntities: [...input.relatedEntities],
            tags: [...input.tags],
            sourceCandidateId: input.sourceCandidateId,
            sourceConversationId: input.sourceConversationId,
            sourceUserMessageId: input.sourceUserMessageId,
            sourceAssistantMessageId: input.sourceAssistantMessageId,
            status: "active",
            importance: input.importance,
            embedding: input.embedding ? { ...input.embedding, vector: [...input.embedding.vector] } : undefined,
            schemaVersion: 1,
            createdAt: input.createdAt,
            updatedAt: input.updatedAt,
        };
        this.rows.push(record);
        return { ...record, embedding: record.embedding ? { ...record.embedding, vector: [...record.embedding.vector] } : undefined };
    }

    async listActiveMemories(input: ListActiveMemoriesInput): Promise<ActiveMemoryRecord[]> {
        const scopeFilter = toArray(input.scope);
        const typeFilter = toArray(input.type);
        // Match the real SQLiteMemoryStore: no implicit default on
        // status. Callers (including the debug route) decide whether
        // to filter and how. The route's own "default to active"
        // policy is applied before this stub is invoked.
        const statusFilter = toArray(input.status);
        const filtered = this.rows
            .filter((r) => r.userId === input.userId)
            .filter((r) => r.characterId === input.characterId)
            .filter((r) => scopeFilter.length === 0 || scopeFilter.includes(r.scope))
            .filter((r) => typeFilter.length === 0 || typeFilter.includes(r.type))
            .filter((r) => statusFilter.length === 0 || statusFilter.includes(r.status))
            .slice()
            .sort((a, b) => {
                if (a.updatedAt !== b.updatedAt) return a.updatedAt < b.updatedAt ? 1 : -1;
                if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
                return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
            });
        return applyLimit(filtered, input.limit).map((r) => ({
            ...r,
            embedding: r.embedding ? { ...r.embedding, vector: [...r.embedding.vector] } : undefined,
        }));
    }

    async findExactActiveMemory(_input: FindExactActiveMemoryInput): Promise<ActiveMemoryRecord | undefined> {
        return undefined;
    }

    async saveMemoryEmbedding(_input: SaveMemoryEmbeddingInput): Promise<void> { /* no-op */ }
}

export class StubMemoryDecisionStore implements MemoryDecisionStore {
    readonly rows: MemoryDecisionRecord[] = [];

    async appendDecision(input: AppendMemoryDecisionInput): Promise<MemoryDecisionRecord> {
        const record: MemoryDecisionRecord = {
            id: makeId(),
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
        this.rows.push(record);
        return { ...record, similarity: record.similarity.map((s) => ({ ...s })) };
    }

    async listDecisions(input: ListMemoryDecisionsInput): Promise<MemoryDecisionRecord[]> {
        const decisionFilter = toArray(input.decision);
        const filtered = this.rows
            .filter((r) => r.userId === input.userId)
            .filter((r) => input.characterId === undefined || r.characterId === input.characterId)
            .filter((r) => input.candidateId === undefined || r.candidateId === input.candidateId)
            .filter((r) => decisionFilter.length === 0 || decisionFilter.includes(r.decision))
            .slice()
            .sort((a, b) => {
                if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
                return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
            });
        return applyLimit(filtered, input.limit).map((r) => ({
            ...r,
            similarity: r.similarity.map((s) => ({ ...s })),
        }));
    }
}
