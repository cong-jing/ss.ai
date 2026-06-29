import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { MemoryWriteCandidate } from "@ss-ai/contracts";
import type {
    Character,
    Conversation,
    ConversationActor,
    MemoryCandidateRecord,
    MemorySettings,
    ModelClient,
    UserProfile,
} from "../src/index.js";
import {
    DEFAULT_MEMORY_SETTINGS,
    MemoryCandidateRecorder,
    MemoryEmbeddingStep,
    MemoryPipelineLogger,
    MemoryPipelineService,
    MemoryStagingProcessor,
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

/**
 * Bundles a {@link MemoryPipelineService} backed by in-memory fakes.
 *
 * Tests inject a deterministic embedding stub directly, so we build
 * the staging-processor + pipeline manually instead of going through
 * `createMemoryPipelineService` (which expects a real ModelClient).
 */
interface MemoryBundle {
    stores: ReturnType<typeof makeInMemoryMemoryStores>;
    pipelineService: MemoryPipelineService;
    embeddingProvider: ReturnType<typeof makeFakeEmbeddingProvider>;
    settings: MemorySettings;
}

function buildMemoryBundle(overrides: { settings?: MemorySettings } = {}): MemoryBundle {
    const stores = makeInMemoryMemoryStores();
    const clock = makeFixedClock();
    const ids = makeSequentialIds();
    const embeddingProvider = makeFakeEmbeddingProvider();
    const settings: MemorySettings = overrides.settings ?? DEFAULT_MEMORY_SETTINGS;

    const pipelineLogger = new MemoryPipelineLogger(undefined);
    const candidateRecorder = new MemoryCandidateRecorder({
        candidateStore: stores.candidateStore,
        clock,
        ids,
    });
    const embeddingStep = new MemoryEmbeddingStep(embeddingProvider, pipelineLogger);
    const stagingProcessor = new MemoryStagingProcessor({
        candidateStore: stores.candidateStore,
        stagingStore: stores.stagingStore,
        embeddingStep,
        clock,
        pipelineLogger,
        settings,
    });
    const pipelineService = new MemoryPipelineService({
        candidateRecorder,
        stagingProcessor,
        pipelineLogger,
        settings,
    });
    return { stores, pipelineService, embeddingProvider, settings };
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

describe("PersonaFlowChatTurnService memory pipeline integration", () => {
    it("records candidates and stages them when both stages are enabled", async () => {
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
            memoryPipelineService: memory.pipelineService,
        });

        const result = await service.chatTurn({
            userId: base.userId,
            characterId: base.characterId,
            conversationId: base.conversationId,
            userMessageText: "hello",
            senderActorId: base.userActorId,
        });

        // Recorder ran: candidate row exists, source backreference
        // points at this turn, character binding is preserved.
        const candidateRows = memory.stores.candidateStore.snapshotAll();
        assert.equal(candidateRows.length, 1);
        assert.equal(candidateRows[0]!.source.assistantMessageId, result.assistantMessageId);
        assert.equal(candidateRows[0]!.source.userMessageId, result.userMessageId);
        assert.equal(candidateRows[0]!.source.characterId, base.characterId);

        // Staging processor ran: one staging row created and a
        // source link points back to the originating candidate.
        const stagingRows = memory.stores.stagingStore.snapshotAll();
        assert.equal(stagingRows.length, 1);
        assert.equal(stagingRows[0]!.text, "User said their name is Alice.");
        assert.equal(stagingRows[0]!.characterId, base.characterId);
        const stagingSources = memory.stores.stagingStore.snapshotSources();
        assert.equal(stagingSources.length, 1);
        assert.equal(stagingSources[0]!.candidateId, candidateRows[0]!.id);

        // Embedding provider was invoked exactly once for the candidate.
        assert.equal(memory.embeddingProvider.calls.length, 1);
    });

    it("records candidates but skips staging when candidateProcessingMode is record_only", async () => {
        const fixture = createTestFixture();
        const base = createBaseData();
        fixture.seed.character(base.character);
        fixture.seed.conversation(base.conversation);
        fixture.seed.actor(base.selfActor);
        fixture.seed.actor(base.userActor);
        fixture.seed.userProfile(base.profile);
        seedModelRuntime(fixture, base.userId);

        const memory = buildMemoryBundle({
            settings: {
                ...DEFAULT_MEMORY_SETTINGS,
                candidateProcessingMode: "record_only",
            },
        });
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
            memoryPipelineService: memory.pipelineService,
        });

        await service.chatTurn({
            userId: base.userId,
            characterId: base.characterId,
            conversationId: base.conversationId,
            userMessageText: "hello",
            senderActorId: base.userActorId,
        });

        // Candidate persisted, but staging is deferred to an async worker.
        assert.equal(memory.stores.candidateStore.snapshotAll().length, 1);
        assert.equal(memory.stores.candidateStore.snapshotAll()[0]!.status, "pending");
        assert.equal(memory.stores.stagingStore.snapshotAll().length, 0);
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

        const memory = buildMemoryBundle({
            settings: {
                ...DEFAULT_MEMORY_SETTINGS,
                enabled: false,
            },
        });
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
            memoryPipelineService: memory.pipelineService,
        });

        await service.chatTurn({
            userId: base.userId,
            characterId: base.characterId,
            conversationId: base.conversationId,
            userMessageText: "hello",
            senderActorId: base.userActorId,
        });

        // Nothing reached the recorder or staging processor.
        assert.equal(memory.stores.candidateStore.snapshotAll().length, 0);
        assert.equal(memory.stores.stagingStore.snapshotAll().length, 0);
        // But candidate observability is preserved: the INFO summary
        // line still runs so existing dashboards keep working.
        assert.equal(
            infoLogs.filter(msg => msg === "persona-flow/memory: candidates logged").length,
            1,
        );
    });

    it("does not call recorder or processor when there are no candidates", async () => {
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
                    memoryWriteCandidates: [],
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
            memoryPipelineService: memory.pipelineService,
        });

        await service.chatTurn({
            userId: base.userId,
            characterId: base.characterId,
            conversationId: base.conversationId,
            userMessageText: "hello",
            senderActorId: base.userActorId,
        });

        assert.equal(memory.stores.candidateStore.snapshotAll().length, 0);
        assert.equal(memory.stores.stagingStore.snapshotAll().length, 0);
        assert.equal(memory.embeddingProvider.calls.length, 0);
    });

    it("keeps chat turn successful when the pipeline service throws (fail-soft)", async () => {
        const fixture = createTestFixture();
        const base = createBaseData();
        fixture.seed.character(base.character);
        fixture.seed.conversation(base.conversation);
        fixture.seed.actor(base.selfActor);
        fixture.seed.actor(base.userActor);
        fixture.seed.userProfile(base.profile);
        seedModelRuntime(fixture, base.userId);

        // Sabotage the pipeline service so any handleChatTurnCandidates call throws.
        const explodingPipeline = {
            handleChatTurnCandidates: async () => {
                throw new Error("simulated pipeline explosion");
            },
            processPendingCandidates: async () => ({ outcomes: [] }),
        } as unknown as MemoryPipelineService;

        const warnings: { message: string; payload?: unknown }[] = [];
        const modelClient = makeStructuredModelClient(
            [
                { text: "Will trigger pipeline error.", scope: "user", type: "fact" },
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
            memoryPipelineService: explodingPipeline,
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
        const pipelineWarn = warnings.find(w => w.message === "persona-flow/memory: pipeline service failed");
        assert.ok(pipelineWarn, "expected fail-soft pipeline warning to be logged");
    });

    it("streamTurn also runs the memory pipeline end to end", async () => {
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
            memoryPipelineService: memory.pipelineService,
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
        const stagingRows = memory.stores.stagingStore.snapshotAll();
        assert.equal(stagingRows.length, 1);
        assert.equal(stagingRows[0]!.text, "User mentioned a deadline next Friday.");
    });
});
