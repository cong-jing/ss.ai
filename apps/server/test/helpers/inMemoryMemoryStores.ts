import type {
    AppendMemoryCandidatesInput,
    CreateMemoryStagingInput,
    FindBySourceCandidateInput,
    FindExactStagingInput,
    IncrementMemoryStagingOccurrenceInput,
    LinkStagingSourceInput,
    ListMemoryCandidatesInput,
    ListMemoryRetainedInput,
    ListMemoryStagingInput,
    ListPendingMemoryCandidatesInput,
    MemoryCandidateRecord,
    MemoryCandidateStore,
    MemoryRetainedRecord,
    MemoryRetainedStore,
    MemoryStagingRecord,
    MemoryStagingSourceRecord,
    MemoryStagingStore,
    UpdateMemoryCandidateStatusInput,
} from "@ss-ai/persona-flow";

/**
 * In-memory memory stores for HTTP integration tests.
 *
 * Satisfy the Batch 3.5 `AppStores` interface and keep enough state
 * for the debug API tests (and any future server tests that need to
 * read back candidate / staging / retained rows).
 *
 * These stubs intentionally implement only the read paths the
 * server actually exercises through HTTP. Write paths called by the
 * pipeline (`appendCandidates`, `updateCandidateStatus`,
 * `create`, `linkSource`, `incrementOccurrence`) are kept simple
 * because the chat-turn → staging pipeline is covered end-to-end
 * against the richer in-memory fakes inside `@ss-ai/persona-flow`
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
            const record: MemoryCandidateRecord = {
                id: makeId(),
                source: { ...input.source },
                seq: startSeq + i,
                scope: draft.scope,
                type: draft.type,
                text: draft.text,
                relatedEntities: draft.relatedEntities ? [...draft.relatedEntities] : [],
                tags: draft.tags ? [...draft.tags] : [],
                candidateReason: draft.reason,
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

    async listPendingCandidates(input: ListPendingMemoryCandidatesInput): Promise<MemoryCandidateRecord[]> {
        const filtered = this.rows
            .filter((r) => r.source.userId === input.userId)
            .filter((r) => r.source.characterId === input.characterId)
            .filter((r) => r.status === "pending")
            .slice()
            .sort((a, b) => {
                if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
                return a.seq - b.seq;
            });
        return filtered.slice(0, input.limit).map((r) => ({ ...r, source: { ...r.source } }));
    }

    async updateCandidateStatus(input: UpdateMemoryCandidateStatusInput): Promise<void> {
        const row = this.rows.find((r) => r.id === input.candidateId);
        if (!row) return;
        row.status = input.status;
        if (input.statusReason !== undefined) {
            row.statusReason = input.statusReason || undefined;
        }
        row.updatedAt = input.updatedAt;
    }
}

export class StubMemoryStagingStore implements MemoryStagingStore {
    readonly rows: MemoryStagingRecord[] = [];
    readonly sources: MemoryStagingSourceRecord[] = [];

    async findBySourceCandidate(input: FindBySourceCandidateInput): Promise<MemoryStagingRecord | undefined> {
        const link = this.sources.find((s) => s.candidateId === input.candidateId);
        if (!link) return undefined;
        const row = this.rows.find((r) => r.id === link.memoryStagingId);
        return row ? this.clone(row) : undefined;
    }

    async findExact(input: FindExactStagingInput): Promise<MemoryStagingRecord | undefined> {
        const match = this.rows
            .filter((r) =>
                r.userId === input.userId
                && r.characterId === input.characterId
                && r.scope === input.scope
                && r.type === input.type
                && r.normalizedText === input.normalizedText,
            )
            .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id.localeCompare(b.id)))[0];
        return match ? this.clone(match) : undefined;
    }

    async create(input: CreateMemoryStagingInput): Promise<MemoryStagingRecord> {
        const record: MemoryStagingRecord = {
            id: makeId(),
            userId: input.userId,
            characterId: input.characterId,
            scope: input.scope,
            type: input.type,
            text: input.text,
            normalizedText: input.normalizedText,
            relatedEntities: [...input.relatedEntities],
            tags: [...input.tags],
            status: input.status,
            statusReason: input.statusReason,
            occurrenceCount: 1,
            firstSeenAt: input.firstSeenAt,
            lastSeenAt: input.now,
            embedding: input.embedding ? { ...input.embedding, vector: [...input.embedding.vector] } : undefined,
            schemaVersion: 1,
            createdAt: input.now,
            updatedAt: input.now,
        };
        this.rows.push(record);
        this.sources.push({
            memoryStagingId: record.id,
            candidateId: input.initialSource.candidateId,
            candidateSeq: input.initialSource.candidateSeq,
            createdAt: input.now,
        });
        return this.clone(record);
    }

    async linkSource(input: LinkStagingSourceInput): Promise<MemoryStagingSourceRecord> {
        if (this.sources.some((s) => s.candidateId === input.candidateId)) {
            throw new Error(`UNIQUE constraint failed: memory_staging_sources.candidate_id (${input.candidateId})`);
        }
        const link: MemoryStagingSourceRecord = {
            memoryStagingId: input.memoryStagingId,
            candidateId: input.candidateId,
            candidateSeq: input.candidateSeq,
            createdAt: input.createdAt,
        };
        this.sources.push(link);
        return { ...link };
    }

    async incrementOccurrence(input: IncrementMemoryStagingOccurrenceInput): Promise<MemoryStagingRecord> {
        const row = this.rows.find((r) => r.id === input.memoryStagingId);
        if (!row) {
            throw new Error(`StubMemoryStagingStore.incrementOccurrence: staging row ${input.memoryStagingId} not found`);
        }
        row.occurrenceCount += 1;
        row.lastSeenAt = input.lastSeenAt;
        row.updatedAt = input.updatedAt;
        return this.clone(row);
    }

    async list(input: ListMemoryStagingInput): Promise<MemoryStagingRecord[]> {
        if (input.sourceCandidateId !== undefined) {
            const link = this.sources.find((s) => s.candidateId === input.sourceCandidateId);
            if (!link) return [];
            const row = this.rows.find((r) => r.id === link.memoryStagingId);
            if (!row) return [];
            return [this.clone(row)].filter((record) => this.matchesFilter(record, input));
        }
        const scopeFilter = toArray(input.scope);
        const typeFilter = toArray(input.type);
        const statusFilter = toArray(input.status);
        const filtered = this.rows
            .filter((r) => r.userId === input.userId)
            .filter((r) => input.characterId === undefined || r.characterId === input.characterId)
            .filter((r) => scopeFilter.length === 0 || scopeFilter.includes(r.scope))
            .filter((r) => typeFilter.length === 0 || typeFilter.includes(r.type))
            .filter((r) => statusFilter.length === 0 || statusFilter.includes(r.status))
            .slice()
            .sort((a, b) => {
                if (a.updatedAt !== b.updatedAt) return a.updatedAt < b.updatedAt ? 1 : -1;
                if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
                return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
            });
        return applyLimit(filtered, input.limit).map((r) => this.clone(r));
    }

    private matchesFilter(record: MemoryStagingRecord, input: ListMemoryStagingInput): boolean {
        if (record.userId !== input.userId) return false;
        if (input.characterId !== undefined && record.characterId !== input.characterId) return false;
        const scopeFilter = toArray(input.scope);
        if (scopeFilter.length > 0 && !scopeFilter.includes(record.scope)) return false;
        const typeFilter = toArray(input.type);
        if (typeFilter.length > 0 && !typeFilter.includes(record.type)) return false;
        const statusFilter = toArray(input.status);
        if (statusFilter.length > 0 && !statusFilter.includes(record.status)) return false;
        return true;
    }

    private clone(record: MemoryStagingRecord): MemoryStagingRecord {
        return {
            ...record,
            relatedEntities: [...record.relatedEntities],
            tags: [...record.tags],
            embedding: record.embedding ? { ...record.embedding, vector: [...record.embedding.vector] } : undefined,
        };
    }
}

/**
 * Read-only retained store stub. Batch 3.5 never writes to this
 * table; tests that need to surface a retained row can push directly
 * into `rows`.
 */
export class StubMemoryRetainedStore implements MemoryRetainedStore {
    readonly rows: MemoryRetainedRecord[] = [];

    async list(input: ListMemoryRetainedInput): Promise<MemoryRetainedRecord[]> {
        const scopeFilter = toArray(input.scope);
        const typeFilter = toArray(input.type);
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
            relatedEntities: [...r.relatedEntities],
            tags: [...r.tags],
            embedding: r.embedding ? { ...r.embedding, vector: [...r.embedding.vector] } : undefined,
        }));
    }
}
