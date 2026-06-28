import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { MemoryWriteCandidate } from "@ss-ai/contracts";
import type {
    Character,
    Conversation,
    ConversationActor,
    MemoryCandidateRecord,
    ModelClient,
    UserProfile,
} from "../src/index.js";
import {
    MemoryCandidateRecorder,
    MemoryCommitService,
    PersonaFlowChatTurnService,
} from "../src/index.js";
import { createTestFixture } from "./helpers/inMemoryStores.js";
import {
    makeFakeEmbeddingProvider,
    makeFixedClock,
    makeInMemoryMemoryStores,
    makeSequentialIds,
} from "./helpers/memoryFakes.js";

// ---------------------------------------------------------------------------
// Lightweight scenario helpers
// ---------------------------------------------------------------------------

function nowIso(): string {
    return new Date().toISOString();
}

interface BaseFixture {
    userId: string;
    characterId: string;
    conversationId: string;
    selfActorId: string;
    userActorId: string;
    character: Character;
    conversation: Conversation;
    selfActor: ConversationActor;
    userActor: ConversationActor;
    profile: UserProfile;
}

function createBaseData(): BaseFixture {
    const userId = "u1";
    const characterId = "c1";
    const conversationId = "conv1";
    const selfActorId = "actor-self";
    const userActorId = "actor-user";

    const character: Character = {
        id: characterId,
        userId,
        name: "ChatA",
        displayName: "SS",
        personaPrompt: "roleplay",
        modelConfig: {},
        generationConfig: {},
        memoryConfig: {},
        status: "active",
        createdAt: nowIso(),
        updatedAt: nowIso(),
    };

    const conversation: Conversation = {
        id: conversationId,
        userId,
        characterId,
        title: null,
        createdAt: nowIso(),
        updatedAt: nowIso(),
    };

    const selfActor: ConversationActor = {
        id: selfActorId,
        conversationId,
        role: "self",
        sourceType: "ai_character",
        displayName: "SS",
        userProfileId: null,
        characterId,
        profileSnapshotJson: null,
        leftAt: null,
        createdAt: nowIso(),
        updatedAt: nowIso(),
    };

    const userActor: ConversationActor = {
        id: userActorId,
        conversationId,
        role: "other",
        sourceType: "logged_user",
        displayName: "User",
        userProfileId: userId,
        characterId: null,
        profileSnapshotJson: null,
        leftAt: null,
        createdAt: nowIso(),
        updatedAt: nowIso(),
    };

    const profile: UserProfile = {
        userId,
        name: "User",
        bio: "bio",
        metadata: {},
        createdAt: nowIso(),
        updatedAt: nowIso(),
    };

    return { userId, characterId, conversationId, selfActorId, userActorId, character, conversation, selfActor, userActor, profile };
}

function seedModelRuntime(fixture: ReturnType<typeof createTestFixture>, userId: string): void {
    const now = nowIso();
    fixture.seed.userPreferences({
        userId,
        modelAssignments: {
            "chat.main": { provider: "mistral", model: "m1" },
        },
        createdAt: now,
        updatedAt: now,
    });
    fixture.seed.providerCredential({
        userId,
        provider: "mistral",
        encryptedApiKey: "test-key",
        createdAt: now,
        updatedAt: now,
    });
}

/** Bundles memory deps for a chat turn integration test. */
interface MemoryBundle {
    stores: ReturnType<typeof makeInMemoryMemoryStores>;
    recorder: MemoryCandidateRecorder;
    commitService: MemoryCommitService;
    embeddingProvider: ReturnType<typeof makeFakeEmbeddingProvider>;
}

function buildMemoryBundle(): MemoryBundle {
    const stores = makeInMemoryMemoryStores();
    const clock = makeFixedClock();
    const ids = makeSequentialIds();
    const embeddingProvider = makeFakeEmbeddingProvider();
    const recorder = new MemoryCandidateRecorder({
        candidateStore: stores.candidateStore,
        clock,
        ids,
    });
    const commitService = new MemoryCommitService({
        candidateStore: stores.candidateStore,
        memoryStore: stores.memoryStore,
        decisionStore: stores.decisionStore,
        embeddingProvider,
        clock,
        ids,
    });
    return { stores, recorder, commitService, embeddingProvider };
}

function makeStructuredModelClient(candidates: MemoryWriteCandidate[], characterId: string): ModelClient {
    return {
        generate: async () => ({
            structuredOutput: {
                events: [
                    { type: "replyText", characterId, text: "hi" },
                ],
                memoryWriteCandidates: candidates,
            },
            toolCalls: [],
        }),
        generateStream: async () => ({ output: "", toolCalls: [], completed: true }),
        listModels: async () => [],
    };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("PersonaFlowChatTurnService memory pipeline (Batch 2)", () => {
    it("records candidates and commits them when both stages are enabled", async () => {
        const fixture = createTestFixture();
        const base = createBaseData();
        fixture.seed.character(base.character);
        fixture.seed.conversation(base.conversation);
        fixture.seed.actor(base.selfActor);
        fixture.seed.actor(base.userActor);
        fixture.seed.userProfile(base.profile);
        seedModelRuntime(fixture, base.userId);

        const memory = buildMemoryBundle();
        const modelClient = makeStructuredModelClient(
            [
                { text: "User said their name is Alice.", scope: "user", type: "fact" },
            ],
            base.characterId,
        );

        const service = new PersonaFlowChatTurnService({
            stores: fixture.stores,
            modelClient,
            promptLogger: { writePromptLog: async () => { } },
            memory: {
                recorder: memory.recorder,
                commitService: memory.commitService,
            },
        });

        const result = await service.chatTurn({
            userId: base.userId,
            characterId: base.characterId,
            conversationId: base.conversationId,
            userMessageText: "hello",
            senderActorId: base.userActorId,
        });

        // Recorder ran: candidate row exists, source backreference points at this turn.
        const candidateRows = memory.stores.candidateStore.snapshotAll();
        assert.equal(candidateRows.length, 1);
        assert.equal(candidateRows[0]!.source.assistantMessageId, result.assistantMessageId);
        assert.equal(candidateRows[0]!.source.userMessageId, result.userMessageId);

        // Commit ran: one active memory created + one decision row appended.
        const memories = memory.stores.memoryStore.snapshotAll();
        assert.equal(memories.length, 1);
        assert.equal(memories[0]!.text, "User said their name is Alice.");
        // Character binding: even though the candidate uses
        // `scope: "user"`, the memory belongs to the current
        // character world. There is no cross-character memory in
        // the new model.
        assert.equal(memories[0]!.characterId, base.characterId);
        const decisions = memory.stores.decisionStore.snapshotAll();
        assert.equal(decisions.length, 1);
        assert.equal(decisions[0]!.decision, "create");
        assert.equal(decisions[0]!.characterId, base.characterId);
        // The recorded candidate's source also carries the current character.
        assert.equal(candidateRows[0]!.source.characterId, base.characterId);

        // Embedding provider was invoked exactly once for the candidate.
        assert.equal(memory.embeddingProvider.calls.length, 1);
    });

    it("records candidates but skips commit when immediateCommitEnabled is false", async () => {
        const fixture = createTestFixture();
        const base = createBaseData();
        fixture.seed.character(base.character);
        fixture.seed.conversation(base.conversation);
        fixture.seed.actor(base.selfActor);
        fixture.seed.actor(base.userActor);
        fixture.seed.userProfile(base.profile);
        seedModelRuntime(fixture, base.userId);

        const memory = buildMemoryBundle();
        const modelClient = makeStructuredModelClient(
            [
                { text: "Deferred commit fact.", scope: "user", type: "fact" },
            ],
            base.characterId,
        );

        const service = new PersonaFlowChatTurnService({
            stores: fixture.stores,
            modelClient,
            promptLogger: { writePromptLog: async () => { } },
            memory: {
                recorder: memory.recorder,
                commitService: memory.commitService,
                config: { enabled: true, immediateCommitEnabled: false },
            },
        });

        await service.chatTurn({
            userId: base.userId,
            characterId: base.characterId,
            conversationId: base.conversationId,
            userMessageText: "hello",
            senderActorId: base.userActorId,
        });

        // Candidate persisted.
        assert.equal(memory.stores.candidateStore.snapshotAll().length, 1);
        // But no memories created, no decisions appended, no embedding called.
        assert.equal(memory.stores.memoryStore.snapshotAll().length, 0);
        assert.equal(memory.stores.decisionStore.snapshotAll().length, 0);
        assert.equal(memory.embeddingProvider.calls.length, 0);
    });

    it("skips the entire memory pipeline when enabled is false", async () => {
        const fixture = createTestFixture();
        const base = createBaseData();
        fixture.seed.character(base.character);
        fixture.seed.conversation(base.conversation);
        fixture.seed.actor(base.selfActor);
        fixture.seed.actor(base.userActor);
        fixture.seed.userProfile(base.profile);
        seedModelRuntime(fixture, base.userId);

        const memory = buildMemoryBundle();
        const modelClient = makeStructuredModelClient(
            [
                { text: "Should not be recorded.", scope: "user", type: "fact" },
            ],
            base.characterId,
        );

        const infoLogs: string[] = [];
        const service = new PersonaFlowChatTurnService({
            stores: fixture.stores,
            modelClient,
            logger: {
                debug: () => { },
                verbose: () => { },
                info: (message) => { infoLogs.push(message); },
                warn: () => { },
                error: () => { },
            },
            promptLogger: { writePromptLog: async () => { } },
            memory: {
                recorder: memory.recorder,
                commitService: memory.commitService,
                config: { enabled: false, immediateCommitEnabled: true },
            },
        });

        await service.chatTurn({
            userId: base.userId,
            characterId: base.characterId,
            conversationId: base.conversationId,
            userMessageText: "hello",
            senderActorId: base.userActorId,
        });

        // Nothing reached the recorder or commit service.
        assert.equal(memory.stores.candidateStore.snapshotAll().length, 0);
        assert.equal(memory.stores.memoryStore.snapshotAll().length, 0);
        assert.equal(memory.stores.decisionStore.snapshotAll().length, 0);
        // But Batch 1 observability is preserved: the INFO summary line
        // still runs so existing dashboards keep working.
        assert.equal(
            infoLogs.filter(msg => msg === "persona-flow/memory: candidates logged").length,
            1,
        );
    });

    it("does not call recorder or commit when there are no candidates", async () => {
        const fixture = createTestFixture();
        const base = createBaseData();
        fixture.seed.character(base.character);
        fixture.seed.conversation(base.conversation);
        fixture.seed.actor(base.selfActor);
        fixture.seed.actor(base.userActor);
        fixture.seed.userProfile(base.profile);
        seedModelRuntime(fixture, base.userId);

        const memory = buildMemoryBundle();
        const modelClient: ModelClient = {
            generate: async () => ({
                structuredOutput: {
                    events: [
                        { type: "replyText", characterId: base.characterId, text: "hi" },
                    ],
                    // no memoryWriteCandidates property at all
                },
                toolCalls: [],
            }),
            generateStream: async () => ({ output: "", toolCalls: [], completed: true }),
            listModels: async () => [],
        };

        const service = new PersonaFlowChatTurnService({
            stores: fixture.stores,
            modelClient,
            promptLogger: { writePromptLog: async () => { } },
            memory: {
                recorder: memory.recorder,
                commitService: memory.commitService,
            },
        });

        await service.chatTurn({
            userId: base.userId,
            characterId: base.characterId,
            conversationId: base.conversationId,
            userMessageText: "hello",
            senderActorId: base.userActorId,
        });

        assert.equal(memory.stores.candidateStore.snapshotAll().length, 0);
        assert.equal(memory.embeddingProvider.calls.length, 0);
    });

    it("keeps chat turn successful when the recorder throws (fail-soft)", async () => {
        const fixture = createTestFixture();
        const base = createBaseData();
        fixture.seed.character(base.character);
        fixture.seed.conversation(base.conversation);
        fixture.seed.actor(base.selfActor);
        fixture.seed.actor(base.userActor);
        fixture.seed.userProfile(base.profile);
        seedModelRuntime(fixture, base.userId);

        const memory = buildMemoryBundle();
        // Sabotage the recorder so any call throws.
        const explodingRecorder = {
            recordCandidates: async () => {
                throw new Error("simulated recorder explosion");
            },
        } as unknown as MemoryCandidateRecorder;

        const warnings: { message: string; payload?: unknown }[] = [];
        const modelClient = makeStructuredModelClient(
            [
                { text: "Will trigger recorder error.", scope: "user", type: "fact" },
            ],
            base.characterId,
        );

        const service = new PersonaFlowChatTurnService({
            stores: fixture.stores,
            modelClient,
            logger: {
                debug: () => { },
                verbose: () => { },
                info: () => { },
                warn: (message, payload) => { warnings.push({ message, payload }); },
                error: () => { },
            },
            promptLogger: { writePromptLog: async () => { } },
            memory: {
                recorder: explodingRecorder,
                commitService: memory.commitService,
            },
        });

        const result = await service.chatTurn({
            userId: base.userId,
            characterId: base.characterId,
            conversationId: base.conversationId,
            userMessageText: "hello",
            senderActorId: base.userActorId,
        });

        // Chat turn still succeeds: assistant message persisted.
        assert.equal(result.output, "hi");
        assert.ok(result.assistantMessageId, "assistant turn should still be persisted");

        // Warn was raised by the fail-soft outer handler.
        const pipelineWarn = warnings.find(w => w.message === "persona-flow/memory: write pipeline failed");
        assert.ok(pipelineWarn, "expected fail-soft pipeline warning to be logged");

        // Commit was never reached.
        assert.equal(memory.stores.memoryStore.snapshotAll().length, 0);
        assert.equal(memory.embeddingProvider.calls.length, 0);
    });

    it("keeps chat turn successful when the commit service throws (fail-soft)", async () => {
        const fixture = createTestFixture();
        const base = createBaseData();
        fixture.seed.character(base.character);
        fixture.seed.conversation(base.conversation);
        fixture.seed.actor(base.selfActor);
        fixture.seed.actor(base.userActor);
        fixture.seed.userProfile(base.profile);
        seedModelRuntime(fixture, base.userId);

        const memory = buildMemoryBundle();
        const explodingCommit = {
            commitCandidates: async () => {
                throw new Error("simulated commit explosion");
            },
        } as unknown as MemoryCommitService;

        const warnings: { message: string; payload?: unknown }[] = [];
        const modelClient = makeStructuredModelClient(
            [
                { text: "Will trigger commit error.", scope: "user", type: "fact" },
            ],
            base.characterId,
        );

        const service = new PersonaFlowChatTurnService({
            stores: fixture.stores,
            modelClient,
            logger: {
                debug: () => { },
                verbose: () => { },
                info: () => { },
                warn: (message, payload) => { warnings.push({ message, payload }); },
                error: () => { },
            },
            promptLogger: { writePromptLog: async () => { } },
            memory: {
                recorder: memory.recorder,
                commitService: explodingCommit,
            },
        });

        const result = await service.chatTurn({
            userId: base.userId,
            characterId: base.characterId,
            conversationId: base.conversationId,
            userMessageText: "hello",
            senderActorId: base.userActorId,
        });

        assert.equal(result.output, "hi");
        assert.ok(result.assistantMessageId);

        // Recorder ran successfully before the explosion.
        assert.equal(memory.stores.candidateStore.snapshotAll().length, 1);

        // Pipeline warning was logged via fail-soft catch.
        const pipelineWarn = warnings.find(w => w.message === "persona-flow/memory: write pipeline failed");
        assert.ok(pipelineWarn, "expected fail-soft pipeline warning to be logged");

        // No active memories created (commit never finished).
        assert.equal(memory.stores.memoryStore.snapshotAll().length, 0);
    });

    it("streamTurn also runs the recorder + commit pipeline", async () => {
        const fixture = createTestFixture();
        const base = createBaseData();
        fixture.seed.character(base.character);
        fixture.seed.conversation(base.conversation);
        fixture.seed.actor(base.selfActor);
        fixture.seed.actor(base.userActor);
        fixture.seed.userProfile(base.profile);
        seedModelRuntime(fixture, base.userId);

        const memory = buildMemoryBundle();

        // The streaming model call expects structured output via streaming.
        const structuredObject = {
            events: [
                { type: "replyText", characterId: base.characterId, text: "stream-hi" },
            ],
            memoryWriteCandidates: [
                { text: "User mentioned a deadline next Friday.", scope: "conversation", type: "event" },
            ],
        };
        const fullJson = JSON.stringify(structuredObject);
        const modelClient: ModelClient = {
            generate: async () => ({ output: "", toolCalls: [] }),
            generateStream: async (_input, callbacks) => {
                callbacks?.onTextDelta?.(fullJson);
                return {
                    output: fullJson,
                    structuredOutput: structuredObject,
                    toolCalls: [],
                    completed: true,
                    finishReason: "stop",
                };
            },
            listModels: async () => [],
        };

        const service = new PersonaFlowChatTurnService({
            stores: fixture.stores,
            modelClient,
            promptLogger: { writePromptLog: async () => { } },
            memory: {
                recorder: memory.recorder,
                commitService: memory.commitService,
            },
        });

        const result = await service.streamTurn({
            userId: base.userId,
            characterId: base.characterId,
            conversationId: base.conversationId,
            userMessageText: "stream me",
            senderActorId: base.userActorId,
        });

        const candidateRows: MemoryCandidateRecord[] = memory.stores.candidateStore.snapshotAll();
        assert.equal(candidateRows.length, 1);
        assert.equal(candidateRows[0]!.source.assistantMessageId, result.assistantMessageId);
        assert.equal(memory.stores.memoryStore.snapshotAll().length, 1);
        assert.equal(memory.stores.decisionStore.snapshotAll()[0]!.decision, "create");
    });
});
