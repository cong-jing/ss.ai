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
    MemoryClock,
    MemoryEmbedInput,
    MemoryEmbedResult,
    MemoryEmbeddingProvider,
    MemoryIdGenerator,
    MemoryLogger,
    MemoryRetainedRecord,
    MemoryRetainedStore,
    MemoryStagingRecord,
    MemoryStagingSourceRecord,
    MemoryStagingStore,
    UpdateMemoryCandidateStatusInput,
} from "../../src/memory/index.js";
import { MEMORY_SCHEMA_VERSION } from "../../src/memory/index.js";

/**
 * In-memory fakes for the memory-write subsystem (Batch 3.5).
 *
 * Tests for the recorder, staging processor, and pipeline service
 * need a `MemoryCandidateStore` / `MemoryStagingStore` /
 * `MemoryRetainedStore` triple that round-trips data the same way
 * SQLite will. We keep them in one helper file so:
 *  - test files stay focused on assertions, not on rebuilding Maps
 *    and dummy `appendXxx` functions;
 *  - any behavioural mismatch between fakes and the real SQLite
 *    stores surfaces in one place.
 *
 * Intentionally small: no transactions, no concurrency control, no
 * JSON corruption guards. Production behaviour belongs in the real
 * SQLite stores; these fakes only need to be faithful enough to
 * drive the in-process pipeline.
 */

// ---------- Candidate store ----------

interface MemoryCandidateStoreOptions {
    /**
     * When set, `appendCandidates` throws this error instead of
     * persisting. Used by the recorder fail-soft tests.
     */
    failOnAppend?: Error;
}

class InMemoryMemoryCandidateStore implements MemoryCandidateStore {
    private readonly records: MemoryCandidateRecord[] = [];
    /** Per-`assistantMessageId` counter so `seq` is reproducible. */
    private readonly seqByTurn = new Map<string, number>();
    private nextId = 1;

    constructor(private readonly options: MemoryCandidateStoreOptions = {}) { }

    /** Read-only escape hatch for tests that need to inspect state. */
    snapshotAll(): MemoryCandidateRecord[] {
        return this.records.map((record) => cloneCandidate(record));
    }

    /**
     * Test convenience: insert a pre-built candidate row, as if
     * `appendCandidates` had already persisted it. Lets staging
     * processor tests skip the recorder and assert directly against
     * the candidate state machine.
     */
    seedCandidate(record: MemoryCandidateRecord): MemoryCandidateRecord {
        const stored = cloneCandidate(record);
        this.records.push(stored);
        return cloneCandidate(stored);
    }

    async appendCandidates(input: AppendMemoryCandidatesInput): Promise<MemoryCandidateRecord[]> {
        if (this.options.failOnAppend) throw this.options.failOnAppend;
        const turnKey = `${input.source.userId}:${input.source.assistantMessageId}`;
        const now = "2026-06-27T00:00:00.000Z";
        const created: MemoryCandidateRecord[] = [];
        for (const draft of input.candidates) {
            const prevSeq = this.seqByTurn.get(turnKey) ?? -1;
            const seq = prevSeq + 1;
            this.seqByTurn.set(turnKey, seq);
            const record: MemoryCandidateRecord = {
                id: `cand-${this.nextId++}`,
                source: { ...input.source },
                seq,
                scope: draft.scope,
                type: draft.type,
                text: draft.text,
                relatedEntities: draft.relatedEntities ? [...draft.relatedEntities] : [],
                tags: draft.tags ? [...draft.tags] : [],
                candidateReason: draft.reason,
                status: "pending",
                schemaVersion: MEMORY_SCHEMA_VERSION,
                createdAt: now,
                updatedAt: now,
            };
            this.records.push(record);
            created.push(cloneCandidate(record));
        }
        return created;
    }

    async listCandidates(input: ListMemoryCandidatesInput): Promise<MemoryCandidateRecord[]> {
        const statusFilter = toArray(input.status);
        return this.records
            .filter((r) => r.source.userId === input.userId)
            .filter((r) => input.characterId === undefined || r.source.characterId === input.characterId)
            .filter((r) => input.conversationId === undefined || r.source.conversationId === input.conversationId)
            .filter((r) => input.assistantMessageId === undefined || r.source.assistantMessageId === input.assistantMessageId)
            .filter((r) => statusFilter.length === 0 || statusFilter.includes(r.status))
            .slice(0, input.limit ?? Number.POSITIVE_INFINITY)
            .map((r) => cloneCandidate(r));
    }

    async listPendingCandidates(input: ListPendingMemoryCandidatesInput): Promise<MemoryCandidateRecord[]> {
        return this.records
            .filter((r) => r.source.userId === input.userId)
            .filter((r) => r.source.characterId === input.characterId)
            .filter((r) => r.status === "pending")
            .slice()
            .sort((a, b) => {
                if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
                return a.seq - b.seq;
            })
            .slice(0, input.limit)
            .map((r) => cloneCandidate(r));
    }

    async updateCandidateStatus(input: UpdateMemoryCandidateStatusInput): Promise<void> {
        const record = this.records.find((r) => r.id === input.candidateId);
        if (!record) throw new Error(`unknown candidate ${input.candidateId}`);
        record.status = input.status;
        record.updatedAt = input.updatedAt;
        if (input.statusReason !== undefined) {
            record.statusReason = input.statusReason || undefined;
        }
    }
}

function cloneCandidate(record: MemoryCandidateRecord): MemoryCandidateRecord {
    return {
        ...record,
        source: { ...record.source },
        relatedEntities: [...record.relatedEntities],
        tags: [...record.tags],
    };
}

// ---------- Staging store ----------

interface MemoryStagingStoreOptions {
    /** When set, `create` throws this error instead of persisting. */
    failOnCreate?: Error;
}

class InMemoryMemoryStagingStore implements MemoryStagingStore {
    private readonly records: MemoryStagingRecord[] = [];
    private readonly sources: MemoryStagingSourceRecord[] = [];
    private nextId = 1;

    constructor(private readonly options: MemoryStagingStoreOptions = {}) { }

    snapshotAll(): MemoryStagingRecord[] {
        return this.records.map((r) => cloneStaging(r));
    }

    snapshotSources(): MemoryStagingSourceRecord[] {
        return this.sources.map((s) => ({ ...s }));
    }

    seedStaging(record: MemoryStagingRecord, sources: MemoryStagingSourceRecord[] = []): MemoryStagingRecord {
        const stored = cloneStaging(record);
        this.records.push(stored);
        for (const link of sources) {
            this.sources.push({ ...link });
        }
        return cloneStaging(stored);
    }

    async findBySourceCandidate(input: FindBySourceCandidateInput): Promise<MemoryStagingRecord | undefined> {
        const link = this.sources.find((s) => s.candidateId === input.candidateId);
        if (!link) return undefined;
        const staging = this.records.find((r) => r.id === link.memoryStagingId);
        if (!staging) return undefined;
        return cloneStaging(staging);
    }

    async findExact(input: FindExactStagingInput): Promise<MemoryStagingRecord | undefined> {
        const found = this.records
            .filter((r) => r.userId === input.userId)
            .filter((r) => r.characterId === input.characterId)
            .filter((r) => r.scope === input.scope)
            .filter((r) => r.type === input.type)
            .filter((r) => r.normalizedText === input.normalizedText)
            .slice()
            .sort((a, b) => {
                if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
                return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
            })[0];
        return found ? cloneStaging(found) : undefined;
    }

    async create(input: CreateMemoryStagingInput): Promise<MemoryStagingRecord> {
        if (this.options.failOnCreate) throw this.options.failOnCreate;
        // Mirror the SQLite UNIQUE(candidate_id) constraint on the
        // sources table.
        if (this.sources.some((s) => s.candidateId === input.initialSource.candidateId)) {
            throw new Error(
                `InMemoryMemoryStagingStore.create: candidate ${input.initialSource.candidateId} already linked`,
            );
        }
        const id = `staging-${this.nextId++}`;
        const record: MemoryStagingRecord = {
            id,
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
            schemaVersion: MEMORY_SCHEMA_VERSION,
            createdAt: input.now,
            updatedAt: input.now,
        };
        this.records.push(record);
        this.sources.push({
            memoryStagingId: id,
            candidateId: input.initialSource.candidateId,
            candidateSeq: input.initialSource.candidateSeq,
            createdAt: input.now,
        });
        return cloneStaging(record);
    }

    async linkSource(input: LinkStagingSourceInput): Promise<MemoryStagingSourceRecord> {
        if (this.sources.some((s) => s.candidateId === input.candidateId)) {
            throw new Error(
                `InMemoryMemoryStagingStore.linkSource: candidate ${input.candidateId} already linked`,
            );
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
        const record = this.records.find((r) => r.id === input.memoryStagingId);
        if (!record) throw new Error(`unknown staging row ${input.memoryStagingId}`);
        record.occurrenceCount += 1;
        record.lastSeenAt = input.lastSeenAt;
        record.updatedAt = input.updatedAt;
        return cloneStaging(record);
    }

    async list(input: ListMemoryStagingInput): Promise<MemoryStagingRecord[]> {
        const scopeFilter = toArray(input.scope);
        const typeFilter = toArray(input.type);
        const statusFilter = toArray(input.status);

        let candidates = this.records.slice();
        if (input.sourceCandidateId !== undefined) {
            const link = this.sources.find((s) => s.candidateId === input.sourceCandidateId);
            if (!link) return [];
            candidates = candidates.filter((r) => r.id === link.memoryStagingId);
        }
        return candidates
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
            })
            .slice(0, input.limit ?? Number.POSITIVE_INFINITY)
            .map((r) => cloneStaging(r));
    }
}

function cloneStaging(record: MemoryStagingRecord): MemoryStagingRecord {
    return {
        ...record,
        relatedEntities: [...record.relatedEntities],
        tags: [...record.tags],
        embedding: record.embedding ? { ...record.embedding, vector: [...record.embedding.vector] } : undefined,
    };
}

// ---------- Retained store (Batch 4 placeholder) ----------

class InMemoryMemoryRetainedStore implements MemoryRetainedStore {
    private readonly records: MemoryRetainedRecord[] = [];
    private nextId = 1;

    snapshotAll(): MemoryRetainedRecord[] {
        return this.records.map((r) => cloneRetained(r));
    }

    /** Test convenience: seed pre-built retained memories. */
    seedRetained(record: Omit<MemoryRetainedRecord, "id" | "schemaVersion"> & { id?: string }): MemoryRetainedRecord {
        const id = record.id ?? `mem-${this.nextId++}`;
        const stored: MemoryRetainedRecord = {
            ...record,
            id,
            schemaVersion: MEMORY_SCHEMA_VERSION,
            relatedEntities: [...record.relatedEntities],
            tags: [...record.tags],
            embedding: record.embedding ? { ...record.embedding, vector: [...record.embedding.vector] } : undefined,
        };
        this.records.push(stored);
        return cloneRetained(stored);
    }

    async list(input: ListMemoryRetainedInput): Promise<MemoryRetainedRecord[]> {
        const scopeFilter = toArray(input.scope);
        const typeFilter = toArray(input.type);
        const statusFilter = toArray(input.status);
        return this.records
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
            })
            .slice(0, input.limit ?? Number.POSITIVE_INFINITY)
            .map((r) => cloneRetained(r));
    }
}

function cloneRetained(record: MemoryRetainedRecord): MemoryRetainedRecord {
    return {
        ...record,
        relatedEntities: [...record.relatedEntities],
        tags: [...record.tags],
        embedding: record.embedding ? { ...record.embedding, vector: [...record.embedding.vector] } : undefined,
    };
}

// ---------- Embedding provider ----------

interface FakeEmbeddingProviderOptions {
    /** Vector dimension. Default 4. */
    dim?: number;
    /** When set, every `embed()` call throws this error. */
    failWith?: Error;
    /**
     * Override provider identity in the returned embedding. Defaults
     * to `"fake.embed"` / `"fake-model"` / `1`.
     */
    provider?: string;
    model?: string;
    version?: number;
    /**
     * Deterministic vector function. Defaults to a small bag-of-char
     * embedding so similar texts produce similar vectors.
     */
    vectorFor?: (text: string, dim: number) => number[];
}

/**
 * Deterministic, dependency-free embedding stub.
 *
 * The default `vectorFor` produces a positional bag-of-char vector:
 * each cell is `sum_over_i 1 if (charCode_i * (i+1)) % dim == cell`.
 * Identical texts -> identical vectors (cosine = 1, so the
 * `needs_judge` branch fires reliably), while two different ASCII
 * English strings end up in mostly disjoint cells (cosine well
 * below `needsJudgeThreshold`, so `create` fires reliably). Real
 * embeddings have richer semantics; the stub only needs to give
 * each branch of the policy a deterministic input it can react to.
 */
function defaultVectorFor(text: string, dim: number): number[] {
    const vector = new Array<number>(dim).fill(0);
    for (let i = 0; i < text.length; i += 1) {
        const code = text.charCodeAt(i);
        // `(i + 1)` so position-1 doesn't collapse onto bucket 0.
        const bucket = (code * (i + 1)) % dim;
        vector[bucket] += 1;
    }
    return vector;
}

interface FakeEmbeddingProvider extends MemoryEmbeddingProvider {
    calls: MemoryEmbedInput[];
}

export function makeFakeEmbeddingProvider(options: FakeEmbeddingProviderOptions = {}): FakeEmbeddingProvider {
    const dim = options.dim ?? 4;
    const provider = options.provider ?? "fake.embed";
    const model = options.model ?? "fake-model";
    const version = options.version ?? 1;
    const vectorFor = options.vectorFor ?? defaultVectorFor;
    const calls: MemoryEmbedInput[] = [];
    return {
        calls,
        async embed(input: MemoryEmbedInput): Promise<MemoryEmbedResult> {
            calls.push({ ...input });
            if (options.failWith) throw options.failWith;
            return {
                embedding: {
                    vector: vectorFor(input.text, dim),
                    provider,
                    model,
                    dim,
                    version,
                    createdAt: "2026-06-27T00:00:00.000Z",
                },
                usage: { promptTokens: input.text.length, totalTokens: input.text.length },
            };
        },
    };
}

// ---------- Logger ----------

export interface RecordingLogger extends MemoryLogger {
    verboseEvents: { message: string; payload?: unknown }[];
    debugEvents: { message: string; payload?: unknown }[];
    warnEvents: { message: string; payload?: unknown }[];
    errorEvents: { message: string; payload?: unknown }[];
    infoEvents: { message: string; payload?: unknown }[];
}

export function makeRecordingLogger(): RecordingLogger {
    const verboseEvents: { message: string; payload?: unknown }[] = [];
    const debugEvents: { message: string; payload?: unknown }[] = [];
    const warnEvents: { message: string; payload?: unknown }[] = [];
    const errorEvents: { message: string; payload?: unknown }[] = [];
    const infoEvents: { message: string; payload?: unknown }[] = [];
    return {
        verboseEvents,
        debugEvents,
        warnEvents,
        errorEvents,
        infoEvents,
        verbose(message, payload) { verboseEvents.push({ message, payload }); },
        debug(message, payload) { debugEvents.push({ message, payload }); },
        info(message, payload) { infoEvents.push({ message, payload }); },
        warn(message, payload) { warnEvents.push({ message, payload }); },
        error(message, payload) { errorEvents.push({ message, payload }); },
    };
}

// ---------- Clock / IDs ----------

export function makeFixedClock(iso: string = "2026-06-27T00:00:00.000Z"): MemoryClock {
    return { nowIso: () => iso };
}

export function makeSequentialIds(prefix: string = "id"): MemoryIdGenerator {
    let next = 1;
    return { randomId: () => `${prefix}-${next++}` };
}

// ---------- Aggregate factory ----------

export interface InMemoryMemoryStores {
    candidateStore: InMemoryMemoryCandidateStore;
    stagingStore: InMemoryMemoryStagingStore;
    retainedStore: InMemoryMemoryRetainedStore;
}

export function makeInMemoryMemoryStores(options: {
    candidateStore?: MemoryCandidateStoreOptions;
    stagingStore?: MemoryStagingStoreOptions;
} = {}): InMemoryMemoryStores {
    return {
        candidateStore: new InMemoryMemoryCandidateStore(options.candidateStore),
        stagingStore: new InMemoryMemoryStagingStore(options.stagingStore),
        retainedStore: new InMemoryMemoryRetainedStore(),
    };
}

// ---------- Local utilities ----------

function toArray<T>(value: T | T[] | undefined): T[] {
    if (value === undefined) return [];
    return Array.isArray(value) ? value : [value];
}
