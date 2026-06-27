import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    MemoryCommitService,
    normalizeMemoryText,
    MEMORY_SCHEMA_VERSION,
} from "../src/memory/index.js";
import type {
    MemoryCandidateRecord,
    MemoryCandidateSource,
    MemoryEmbedding,
} from "../src/memory/index.js";
import {
    makeFakeEmbeddingProvider,
    makeFixedClock,
    makeInMemoryMemoryStores,
    makeRecordingLogger,
    makeSequentialIds,
    type InMemoryMemoryStores,
} from "./helpers/memoryFakes.js";

const NOW = "2026-06-27T00:00:00.000Z";

function makeSource(overrides: Partial<MemoryCandidateSource> = {}): MemoryCandidateSource {
    return {
        userId: "u1",
        characterId: "c1",
        conversationId: "conv1",
        userMessageId: "u-msg-1",
        assistantMessageId: "a-msg-1",
        requestId: "req-1",
        modelCallPurpose: "chat.main",
        ...overrides,
    };
}

let candidateIdCounter = 1;
function makeCandidate(text: string, overrides: Partial<MemoryCandidateRecord> = {}): MemoryCandidateRecord {
    return {
        id: `cand-${candidateIdCounter++}`,
        source: makeSource(),
        seq: 0,
        scope: "user",
        type: "fact",
        text,
        normalizedText: normalizeMemoryText(text),
        relatedEntities: [],
        tags: [],
        status: "pending",
        schemaVersion: MEMORY_SCHEMA_VERSION,
        createdAt: NOW,
        updatedAt: NOW,
        ...overrides,
    };
}

/**
 * Builds a candidate and seeds it into the candidate store so the
 * commit service can update its status. In production the recorder
 * inserts the row; in tests we skip the recorder and seed directly
 * to keep the assertions focused on the commit pipeline.
 */
function seedCandidate(
    stores: InMemoryMemoryStores,
    text: string,
    overrides: Partial<MemoryCandidateRecord> = {},
): MemoryCandidateRecord {
    const record = makeCandidate(text, overrides);
    stores.candidateStore.seedCandidate(record);
    return record;
}

function makeService(stores: InMemoryMemoryStores, options: {
    embedDim?: number;
    embedFails?: Error;
    logger?: ReturnType<typeof makeRecordingLogger>;
    embedProvider?: string;
    embedModel?: string;
    embedVersion?: number;
} = {}) {
    const embeddingProvider = makeFakeEmbeddingProvider({
        dim: options.embedDim ?? 8,
        failWith: options.embedFails,
        provider: options.embedProvider,
        model: options.embedModel,
        version: options.embedVersion,
    });
    const service = new MemoryCommitService({
        candidateStore: stores.candidateStore,
        memoryStore: stores.memoryStore,
        decisionStore: stores.decisionStore,
        embeddingProvider,
        clock: makeFixedClock(NOW),
        ids: makeSequentialIds(),
        logger: options.logger,
    });
    return { service, embeddingProvider };
}

describe("MemoryCommitService", () => {
    it("creates a new memory when no similar one exists", async () => {
        const stores = makeInMemoryMemoryStores();
        const { service } = makeService(stores);
        const candidate = seedCandidate(stores, "用户喜欢喝绿茶");

        const { outcomes } = await service.commitCandidates({ candidates: [candidate] });

        assert.equal(outcomes.length, 1);
        const outcome = outcomes[0]!;
        assert.equal(outcome.decision, "create");
        assert.ok(outcome.memoryId, "create outcome must carry the new memoryId");
        // candidate moves to "committed" and a "create" decision row is written
        const persistedCandidate = stores.candidateStore.snapshotAll()[0]!;
        assert.equal(persistedCandidate.status, "committed");
        const decisions = stores.decisionStore.snapshotAll();
        assert.equal(decisions.length, 1);
        assert.equal(decisions[0]!.decision, "create");
        // and a matching memory exists
        const memories = stores.memoryStore.snapshotAll();
        assert.equal(memories.length, 1);
        assert.equal(memories[0]!.text, "用户喜欢喝绿茶");
        // embedding signature is persisted alongside the memory
        assert.equal(memories[0]!.embedding?.provider, "fake.embed");
    });

    it("ignores an exact normalized-text duplicate without calling the embedding provider", async () => {
        const stores = makeInMemoryMemoryStores();
        // Pre-seed: same normalizedText, same scope/type/user.
        stores.memoryStore.seedMemory({
            userId: "u1",
            characterId: undefined,
            scope: "user",
            type: "fact",
            text: "User Loves Coffee",
            normalizedText: normalizeMemoryText("User Loves Coffee"),
            relatedEntities: [],
            tags: [],
            sourceCandidateId: "seed-cand",
            sourceConversationId: "seed-conv",
            sourceUserMessageId: "seed-u",
            sourceAssistantMessageId: "seed-a",
            status: "active",
            importance: 0.5,
            createdAt: NOW,
            updatedAt: NOW,
        });
        const { service, embeddingProvider } = makeService(stores);
        // Duplicate by normalization (different casing/whitespace).
        const candidate = seedCandidate(stores, "  user loves coffee  ");

        const { outcomes } = await service.commitCandidates({ candidates: [candidate] });

        assert.equal(outcomes[0]!.decision, "ignore_duplicate");
        assert.equal(embeddingProvider.calls.length, 0, "exact-dup short-circuit must skip embedding");
        // No new memory was created.
        assert.equal(stores.memoryStore.snapshotAll().length, 1);
        // Candidate moves to ignored_duplicate.
        assert.equal(stores.candidateStore.snapshotAll()[0]!.status, "ignored_duplicate");
    });

    it("returns ignore_low_value for too-short text and never calls the embedding provider", async () => {
        const stores = makeInMemoryMemoryStores();
        const { service, embeddingProvider } = makeService(stores);
        // Single non-letter/digit symbol is low value (no_letter_or_digit).
        const candidate = seedCandidate(stores, "!!");

        const { outcomes } = await service.commitCandidates({ candidates: [candidate] });

        assert.equal(outcomes[0]!.decision, "ignore_low_value");
        assert.ok(outcomes[0]!.reason, "low-value reason must be propagated");
        assert.equal(embeddingProvider.calls.length, 0);
        assert.equal(stores.candidateStore.snapshotAll()[0]!.status, "ignored_low_value");
        assert.equal(stores.memoryStore.snapshotAll().length, 0);
    });

    it("routes near-duplicates above needsJudgeThreshold to needs_judge without creating a memory", async () => {
        const stores = makeInMemoryMemoryStores();
        // Force every existing memory to be ranked as very similar
        // by giving them the same vector the embedding provider
        // will return for the new candidate.
        const { service, embeddingProvider } = makeService(stores, { embedDim: 8 });
        // First, commit one candidate so a memory with a known
        // embedding ends up in the store.
        const seedCand = seedCandidate(stores, "loves matcha lattes a lot");
        await service.commitCandidates({ candidates: [seedCand] });
        // Now feed a near-duplicate: same text means our deterministic
        // embedder returns the same vector → cosine similarity = 1,
        // which falls in [exactDuplicateThreshold, ∞) and routes to
        // needs_judge per the Batch 2/3 policy.
        const near = seedCandidate(stores, "Loves matcha lattes a lot!", { id: "cand-near" });

        const { outcomes } = await service.commitCandidates({ candidates: [near] });

        assert.equal(outcomes[0]!.decision, "needs_judge");
        // embedding still ran (we need a vector to rank)
        assert.equal(embeddingProvider.calls.length, 2);
        assert.equal(outcomes[0]!.topSimilarity! >= 0.95, true, "top similarity should be near 1");
        // candidate row reflects the judge requirement
        const nearRow = stores.candidateStore.snapshotAll().find((r) => r.id === "cand-near")!;
        assert.equal(nearRow.status, "needs_judge");
        // and no new memory was created
        assert.equal(stores.memoryStore.snapshotAll().length, 1);
    });

    it("degrades to embedding_failed when the provider throws and never bubbles the error", async () => {
        const stores = makeInMemoryMemoryStores();
        const { service, embeddingProvider } = makeService(stores, {
            embedFails: new Error("simulated provider outage"),
        });
        const candidate = seedCandidate(stores, "a candidate we cannot embed");

        const { outcomes } = await service.commitCandidates({ candidates: [candidate] });

        assert.equal(outcomes[0]!.decision, "embedding_failed");
        assert.equal(embeddingProvider.calls.length, 1);
        // candidate status reflects the failure mode
        assert.equal(stores.candidateStore.snapshotAll()[0]!.status, "embedding_failed");
        // decision row was still written so we have a paper trail
        assert.equal(stores.decisionStore.snapshotAll()[0]!.decision, "embedding_failed");
        // no memory created
        assert.equal(stores.memoryStore.snapshotAll().length, 0);
    });

    it("skips memories whose embedding signature does not match and surfaces the per-reason breakdown", async () => {
        const stores = makeInMemoryMemoryStores();
        // Seed two memories: one with a wrong signature (should land
        // in `skipped.signatureMismatch`) and one with a corrupt
        // declared dim (should land in `skipped.corruptDim`). The
        // breakdown must attribute each row to exactly one reason
        // so debug output isn't lying by aggregation.
        const mismatchedEmbedding: MemoryEmbedding = {
            vector: [1, 0, 0, 0, 0, 0, 0, 0],
            provider: "other.provider",
            model: "other-model",
            dim: 8,
            version: 1,
            createdAt: NOW,
        };
        const corruptEmbedding: MemoryEmbedding = {
            // declared dim 8 but vector length 5 -> corrupt
            vector: [1, 0, 0, 0, 0],
            provider: "fake.embed",
            model: "fake-model",
            dim: 8,
            version: 1,
            createdAt: NOW,
        };
        stores.memoryStore.seedMemory({
            userId: "u1",
            characterId: undefined,
            scope: "user",
            type: "fact",
            text: "Mismatched-signature memory",
            normalizedText: normalizeMemoryText("Mismatched-signature memory"),
            relatedEntities: [],
            tags: [],
            sourceCandidateId: "old-cand-1",
            sourceConversationId: "old-conv",
            sourceUserMessageId: "old-u",
            sourceAssistantMessageId: "old-a",
            status: "active",
            importance: 0.5,
            embedding: mismatchedEmbedding,
            createdAt: NOW,
            updatedAt: NOW,
        });
        stores.memoryStore.seedMemory({
            userId: "u1",
            characterId: undefined,
            scope: "user",
            type: "fact",
            text: "Corrupt-dim memory",
            normalizedText: normalizeMemoryText("Corrupt-dim memory"),
            relatedEntities: [],
            tags: [],
            sourceCandidateId: "old-cand-2",
            sourceConversationId: "old-conv",
            sourceUserMessageId: "old-u",
            sourceAssistantMessageId: "old-a",
            status: "active",
            importance: 0.5,
            embedding: corruptEmbedding,
            createdAt: NOW,
            updatedAt: NOW,
        });
        const logger = makeRecordingLogger();
        const { service } = makeService(stores, { logger });
        const candidate = seedCandidate(stores, "fresh fact about a thing");

        const { outcomes } = await service.commitCandidates({ candidates: [candidate] });

        // Both old memories were excluded, so the scan should look
        // like "no similar memories" and the candidate should be
        // created fresh.
        assert.equal(outcomes[0]!.decision, "create");
        assert.equal(outcomes[0]!.scannedCount, 2);
        // Counts are split per reason — old aggregated `skippedCount`
        // would have hidden the corrupt row entirely.
        assert.equal(outcomes[0]!.skipped?.signatureMismatch, 1);
        assert.equal(outcomes[0]!.skipped?.corruptDim, 1);
        assert.equal(outcomes[0]!.skipped?.noEmbedding, 0);
        assert.equal(outcomes[0]!.skipped?.nonFiniteSimilarity, 0);
        const skippedLog = logger.debugEvents.find((e) => e.message === "memory.commit.skipped_signature_mismatch");
        assert.ok(skippedLog, "logger must record skipped_signature_mismatch event for the mismatched row");
    });

    it("isolates per-candidate failures: a poison candidate doesn't break the rest of the batch", async () => {
        const stores = makeInMemoryMemoryStores();
        // dim=128 keeps two unrelated English sentences below the
        // needs_judge threshold so we can assert `create` for the
        // third candidate without the bag-of-chars stub bleeding
        // shared-suffix mass between buckets.
        const { service } = makeService(stores, { embedDim: 128 });
        const ok1 = seedCandidate(stores, "first good fact");
        // Force a failure on the second candidate by giving it a
        // normalizedText our exact-dup lookup will throw on.
        // Easier approach: monkey-patch the memoryStore for one call
        // by wrapping it. We chain a finite reject through a Proxy
        // on findExactActiveMemory for the second candidate's text.
        const originalFind = stores.memoryStore.findExactActiveMemory.bind(stores.memoryStore);
        let calls = 0;
        stores.memoryStore.findExactActiveMemory = async (input) => {
            calls += 1;
            if (calls === 2) throw new Error("simulated store hiccup");
            return originalFind(input);
        };
        const poison = seedCandidate(stores, "this one explodes");
        const ok2 = seedCandidate(stores, "third good fact");

        const { outcomes } = await service.commitCandidates({ candidates: [ok1, poison, ok2] });

        assert.equal(outcomes.length, 3);
        assert.equal(outcomes[0]!.decision, "create");
        assert.equal(outcomes[1]!.decision, "error");
        assert.ok(outcomes[1]!.error, "failed candidate carries the error on the outcome");
        assert.equal(outcomes[2]!.decision, "create");
        // The first and third candidates produced real memories.
        const memories = stores.memoryStore.snapshotAll();
        assert.equal(memories.length, 2);
    });

    it("emits at least the documented stage events when a verbose logger is wired", async () => {
        const stores = makeInMemoryMemoryStores();
        const logger = makeRecordingLogger();
        const { service } = makeService(stores, { logger });
        const candidate = seedCandidate(stores, "verbose logging fact");

        await service.commitCandidates({ candidates: [candidate] });

        const stageMessages = new Set(logger.debugEvents.map((e) => e.message));
        // These four are explicitly called out by the Step 4 spec.
        assert.equal(stageMessages.has("memory.commit.candidate_received"), true);
        assert.equal(stageMessages.has("memory.commit.embedding_requested"), true);
        assert.equal(stageMessages.has("memory.commit.similarity_scan_finished"), true);
        assert.equal(stageMessages.has("memory.commit.decision_made"), true);
    });
});
