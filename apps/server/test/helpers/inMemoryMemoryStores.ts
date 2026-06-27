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
 * Minimal in-memory memory stores used only by HTTP integration
 * tests. They satisfy the `AppStores` interface so the rest of the
 * test setup type-checks. None of the current server tests exercise
 * the memory write pipeline (that wiring lands in Step 6+); when
 * those tests appear they should construct the richer
 * `makeInMemoryMemoryStores()` from `@ss-ai/persona-flow` test
 * helpers instead of upgrading these stubs.
 */

let nextId = 0;
function makeId(): string {
    nextId += 1;
    return `mem-stub-${nextId}`;
}

export class StubMemoryCandidateStore implements MemoryCandidateStore {
    readonly rows: MemoryCandidateRecord[] = [];

    async appendCandidates(input: AppendMemoryCandidatesInput): Promise<MemoryCandidateRecord[]> {
        const now = new Date().toISOString();
        const added: MemoryCandidateRecord[] = [];
        for (let i = 0; i < input.candidates.length; i += 1) {
            const draft = input.candidates[i]!;
            const normalized = input.normalizedTexts[i]!;
            const record: MemoryCandidateRecord = {
                id: makeId(),
                source: { ...input.source },
                seq: this.rows.length + i,
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
        return added;
    }

    async listCandidates(_input: ListMemoryCandidatesInput): Promise<MemoryCandidateRecord[]> {
        return [];
    }

    async updateCandidateStatus(_input: UpdateMemoryCandidateStatusInput): Promise<void> { /* no-op */ }
    async saveCandidateEmbedding(_input: SaveCandidateEmbeddingInput): Promise<void> { /* no-op */ }
}

export class StubMemoryStore implements MemoryStore {
    async createMemory(input: CreateMemoryInput): Promise<ActiveMemoryRecord> {
        return {
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
            embedding: input.embedding,
            schemaVersion: 1,
            createdAt: input.createdAt,
            updatedAt: input.updatedAt,
        };
    }

    async listActiveMemories(_input: ListActiveMemoriesInput): Promise<ActiveMemoryRecord[]> {
        return [];
    }

    async findExactActiveMemory(_input: FindExactActiveMemoryInput): Promise<ActiveMemoryRecord | undefined> {
        return undefined;
    }

    async saveMemoryEmbedding(_input: SaveMemoryEmbeddingInput): Promise<void> { /* no-op */ }
}

export class StubMemoryDecisionStore implements MemoryDecisionStore {
    async appendDecision(input: AppendMemoryDecisionInput): Promise<MemoryDecisionRecord> {
        return {
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
    }

    async listDecisions(_input: ListMemoryDecisionsInput): Promise<MemoryDecisionRecord[]> {
        return [];
    }
}
