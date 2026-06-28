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
    MemoryClock,
    MemoryDecisionKind,
    MemoryDecisionRecord,
    MemoryDecisionStore,
    MemoryEmbedInput,
    MemoryEmbedResult,
    MemoryEmbeddingProvider,
    MemoryIdGenerator,
    MemoryLogger,
    MemoryStore,
    SaveCandidateEmbeddingInput,
    SaveMemoryEmbeddingInput,
    UpdateMemoryCandidateStatusInput,
} from "../../src/memory/index.js";
import { MEMORY_SCHEMA_VERSION } from "../../src/memory/index.js";

/**
 * In-memory fakes for the memory-write subsystem.
 *
 * Tests for `MemoryCandidateRecorder` and `MemoryCandidateProcessor` need
 * real `MemoryCandidateStore` / `MemoryStore` / `MemoryDecisionStore`
 * implementations that round-trip data the same way SQLite will. We
 * keep them in one helper file so:
 *  - test files stay focused on the assertions, not on rebuilding
 *    Maps and dummy `appendXxx` functions;
 *  - the recorder and the commit service can share fixtures (and any
 *    behavioural mismatch between fakes and the real SQLite store
 *    surfaces in one place).
 *
 * The fakes are intentionally small: no transactions, no concurrency
 * control, no JSON corruption guards. Production behaviour belongs in
 * the real SQLite stores (Step 5) — these fakes only need to be
 * faithful enough to drive the in-process pipeline.
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
        return this.records.map((record) => ({ ...record }));
    }

    /**
     * Test convenience: insert a pre-built candidate row, as if
     * `appendCandidates` had already persisted it. Lets commit-service
     * tests skip the recorder and assert directly against the
     * candidate state machine.
     */
    seedCandidate(record: MemoryCandidateRecord): MemoryCandidateRecord {
        const stored: MemoryCandidateRecord = {
            ...record,
            source: { ...record.source },
            relatedEntities: [...record.relatedEntities],
            tags: [...record.tags],
            embedding: record.embedding
                ? { ...record.embedding, vector: [...record.embedding.vector] }
                : undefined,
        };
        this.records.push(stored);
        return { ...stored };
    }

    async appendCandidates(input: AppendMemoryCandidatesInput): Promise<MemoryCandidateRecord[]> {
        if (this.options.failOnAppend) throw this.options.failOnAppend;
        if (input.candidates.length !== input.normalizedTexts.length) {
            throw new Error(
                `InMemoryMemoryCandidateStore: candidates.length (${input.candidates.length}) != normalizedTexts.length (${input.normalizedTexts.length})`,
            );
        }
        const turnKey = `${input.source.userId}:${input.source.assistantMessageId}`;
        const now = "2026-06-27T00:00:00.000Z";
        const created: MemoryCandidateRecord[] = [];
        for (let i = 0; i < input.candidates.length; i += 1) {
            const draft = input.candidates[i]!;
            const normalized = input.normalizedTexts[i]!;
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
                normalizedText: normalized,
                relatedEntities: draft.relatedEntities ? [...draft.relatedEntities] : [],
                tags: draft.tags ? [...draft.tags] : [],
                reason: draft.reason,
                status: "pending",
                schemaVersion: MEMORY_SCHEMA_VERSION,
                createdAt: now,
                updatedAt: now,
            };
            this.records.push(record);
            created.push({ ...record });
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
            .map((r) => ({ ...r }));
    }

    async updateCandidateStatus(input: UpdateMemoryCandidateStatusInput): Promise<void> {
        const record = this.records.find((r) => r.id === input.candidateId);
        if (!record) throw new Error(`unknown candidate ${input.candidateId}`);
        record.status = input.status;
        record.updatedAt = input.updatedAt;
        if (input.reason !== undefined) {
            // Reason lives on the decision row in the real schema; the
            // fake keeps it on the candidate too for easier assertion.
            record.reason = input.reason;
        }
    }

    async saveCandidateEmbedding(input: SaveCandidateEmbeddingInput): Promise<void> {
        const record = this.records.find((r) => r.id === input.candidateId);
        if (!record) throw new Error(`unknown candidate ${input.candidateId}`);
        record.embedding = {
            ...input.embedding,
            vector: [...input.embedding.vector],
        };
        record.updatedAt = input.updatedAt;
        record.status = "embedded";
    }
}

// ---------- Memory store ----------

interface MemoryStoreOptions {
    /** When set, `createMemory` throws this error instead of persisting. */
    failOnCreate?: Error;
    /** When set, `listActiveMemories` throws this error. */
    failOnList?: Error;
}

class InMemoryMemoryStore implements MemoryStore {
    private readonly records: ActiveMemoryRecord[] = [];
    private nextId = 1;

    constructor(private readonly options: MemoryStoreOptions = {}) { }

    snapshotAll(): ActiveMemoryRecord[] {
        return this.records.map((record) => ({ ...record }));
    }

    /** Test convenience: seed the store with pre-built memories. */
    seedMemory(record: Omit<ActiveMemoryRecord, "id" | "schemaVersion"> & { id?: string }): ActiveMemoryRecord {
        const id = record.id ?? `mem-${this.nextId++}`;
        const stored: ActiveMemoryRecord = {
            ...record,
            id,
            schemaVersion: MEMORY_SCHEMA_VERSION,
            relatedEntities: [...record.relatedEntities],
            tags: [...record.tags],
            embedding: record.embedding ? { ...record.embedding, vector: [...record.embedding.vector] } : undefined,
        };
        this.records.push(stored);
        return { ...stored };
    }

    async createMemory(input: CreateMemoryInput): Promise<ActiveMemoryRecord> {
        if (this.options.failOnCreate) throw this.options.failOnCreate;
        const record: ActiveMemoryRecord = {
            id: `mem-${this.nextId++}`,
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
            schemaVersion: MEMORY_SCHEMA_VERSION,
            createdAt: input.createdAt,
            updatedAt: input.updatedAt,
        };
        this.records.push(record);
        return { ...record };
    }

    async listActiveMemories(input: ListActiveMemoriesInput): Promise<ActiveMemoryRecord[]> {
        if (this.options.failOnList) throw this.options.failOnList;
        const scopeFilter = toArray(input.scope);
        const typeFilter = toArray(input.type);
        const statusFilter = toArray(input.status ?? "active");
        // Mirror the port contract: every memory is bound to one
        // character world, so always filter by `characterId` and
        // sort deterministically (updatedAt DESC, createdAt DESC,
        // id ASC) before any truncation so this fake matches the
        // SQLite store.
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
            .map((r) => ({ ...r, embedding: r.embedding ? { ...r.embedding, vector: [...r.embedding.vector] } : undefined }));
    }

    async findExactActiveMemory(input: FindExactActiveMemoryInput): Promise<ActiveMemoryRecord | undefined> {
        const found = this.records.find((r) =>
            r.userId === input.userId
            && r.characterId === input.characterId
            && r.scope === input.scope
            && r.type === input.type
            && r.status === "active"
            && r.normalizedText === input.normalizedText,
        );
        return found ? { ...found } : undefined;
    }

    async saveMemoryEmbedding(input: SaveMemoryEmbeddingInput): Promise<void> {
        const record = this.records.find((r) => r.id === input.memoryId);
        if (!record) throw new Error(`unknown memory ${input.memoryId}`);
        record.embedding = { ...input.embedding, vector: [...input.embedding.vector] };
        record.updatedAt = input.updatedAt;
    }
}

// ---------- Decision store ----------

class InMemoryMemoryDecisionStore implements MemoryDecisionStore {
    private readonly records: MemoryDecisionRecord[] = [];
    private nextId = 1;

    snapshotAll(): MemoryDecisionRecord[] {
        return this.records.map((record) => ({
            ...record,
            similarity: record.similarity.map((entry) => ({ ...entry })),
        }));
    }

    async appendDecision(input: AppendMemoryDecisionInput): Promise<MemoryDecisionRecord> {
        const record: MemoryDecisionRecord = {
            id: `dec-${this.nextId++}`,
            candidateId: input.candidateId,
            userId: input.userId,
            characterId: input.characterId,
            decision: input.decision,
            memoryId: input.memoryId,
            reason: input.reason,
            similarity: input.similarity.map((entry) => ({ ...entry })),
            policyVersion: input.policyVersion,
            createdAt: input.createdAt,
        };
        this.records.push(record);
        return { ...record, similarity: record.similarity.map((entry) => ({ ...entry })) };
    }

    async listDecisions(input: ListMemoryDecisionsInput): Promise<MemoryDecisionRecord[]> {
        const decisionFilter = toArray<MemoryDecisionKind>(input.decision);
        return this.records
            .filter((r) => r.userId === input.userId)
            .filter((r) => input.characterId === undefined || r.characterId === input.characterId)
            .filter((r) => input.candidateId === undefined || r.candidateId === input.candidateId)
            .filter((r) => decisionFilter.length === 0 || decisionFilter.includes(r.decision))
            .slice(0, input.limit ?? Number.POSITIVE_INFINITY)
            .map((r) => ({ ...r, similarity: r.similarity.map((entry) => ({ ...entry })) }));
    }
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
 * Identical texts → identical vectors (cosine = 1, so the
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
    debugEvents: { message: string; payload?: unknown }[];
    warnEvents: { message: string; payload?: unknown }[];
    errorEvents: { message: string; payload?: unknown }[];
    infoEvents: { message: string; payload?: unknown }[];
}

export function makeRecordingLogger(): RecordingLogger {
    const debugEvents: { message: string; payload?: unknown }[] = [];
    const warnEvents: { message: string; payload?: unknown }[] = [];
    const errorEvents: { message: string; payload?: unknown }[] = [];
    const infoEvents: { message: string; payload?: unknown }[] = [];
    return {
        debugEvents,
        warnEvents,
        errorEvents,
        infoEvents,
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
    memoryStore: InMemoryMemoryStore;
    decisionStore: InMemoryMemoryDecisionStore;
}

export function makeInMemoryMemoryStores(options: {
    candidateStore?: MemoryCandidateStoreOptions;
    memoryStore?: MemoryStoreOptions;
} = {}): InMemoryMemoryStores {
    return {
        candidateStore: new InMemoryMemoryCandidateStore(options.candidateStore),
        memoryStore: new InMemoryMemoryStore(options.memoryStore),
        decisionStore: new InMemoryMemoryDecisionStore(),
    };
}

// ---------- Local utilities ----------

function toArray<T>(value: T | T[] | undefined): T[] {
    if (value === undefined) return [];
    return Array.isArray(value) ? value : [value];
}
