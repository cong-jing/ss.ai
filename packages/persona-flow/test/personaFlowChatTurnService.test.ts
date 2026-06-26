import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Character, Conversation, ConversationActor, ModelClient, UserProfile } from "../src/index.js";
import { PersonaFlowChatTurnService } from "../src/index.js";
import { createTestFixture } from "./helpers/inMemoryStores.js";

function nowIso(): string {
    return new Date().toISOString();
}

function createBaseData() {
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

describe("persona-flow chat turn service", () => {
    it("chatTurn appends assistant reply from submit_turn_events tool call", async () => {
        const fixture = createTestFixture();
        const base = createBaseData();
        fixture.seed.character(base.character);
        fixture.seed.conversation(base.conversation);
        fixture.seed.actor(base.selfActor);
        fixture.seed.actor(base.userActor);
        fixture.seed.userProfile(base.profile);
        seedModelRuntime(fixture, base.userId);

        const modelClient: ModelClient = {
            generate: async (input) => {
                assert.equal(input.structuredOutputSchema?.jsonSchema?.name, "submit_turn_events");
                assert.equal(input.tools, undefined);
                assert.equal(input.toolChoice, undefined);

                return {
                    structuredOutput: {
                        events: [
                            {
                                type: "replyText",
                                characterId: base.characterId,
                                text: "SS: hello back",
                            },
                        ],
                    },
                    toolCalls: [],
                };
            },
            generateStream: async () => ({ output: "", toolCalls: [], completed: true }),
            listModels: async () => [],
        };

        const service = new PersonaFlowChatTurnService({
            stores: fixture.stores,
            modelClient,
            promptLogger: { writePromptLog: async () => { } },
        });

        const result = await service.chatTurn({
            userId: base.userId,
            characterId: base.characterId,
            conversationId: base.conversationId,
            userMessageText: "hello",
            senderActorId: base.userActorId,
        });

        assert.equal(result.output, "hello back");
        assert.equal(result.apiKeySource, "user");
        assert.ok(result.assistantMessageId);
        assert.deepEqual(result.turnEvents, [
            {
                type: "replyText",
                characterId: base.characterId,
                text: "SS: hello back",
            },
        ]);

        const messages = fixture.inspect.messages(base.conversationId);
        const assistantMessages = messages.filter(message => message.senderActorId === base.selfActorId);
        assert.equal(assistantMessages.length, 1);
        assert.equal(assistantMessages[0].displayText, "hello back");
        assert.deepEqual(assistantMessages[0].turnEvents, result.turnEvents);
    });

    it("streamTurn drives chunks from structured-output JSON text deltas and persists assistant message", async () => {
        const fixture = createTestFixture();
        const base = createBaseData();
        fixture.seed.character(base.character);
        fixture.seed.conversation(base.conversation);
        fixture.seed.actor(base.selfActor);
        fixture.seed.actor(base.userActor);
        fixture.seed.userProfile(base.profile);
        seedModelRuntime(fixture, base.userId);

        const seenChunks: string[] = [];
        const seenPrompts: Array<Array<{ role: "system" | "user" | "assistant"; content: string }>> = [];
        const seenPreviews: Array<{ eventIndex: number; eventType: string }> = [];

        // Pre-compute the full JSON object the model will stream and slice it
        // into fragments so we can simulate provider-side streaming of the
        // structured-output text channel.
        const structuredObject = {
            events: [
                {
                    type: "replyText",
                    characterId: base.characterId,
                    text: "SS: Hello World",
                },
                {
                    type: "expression",
                    characterId: base.characterId,
                    expression: "happy",
                },
            ],
        };
        const fullJson = JSON.stringify(structuredObject);
        const fragmentSize = 8;
        const fragments: string[] = [];
        for (let i = 0; i < fullJson.length; i += fragmentSize) {
            fragments.push(fullJson.slice(i, i + fragmentSize));
        }

        const modelClient: ModelClient = {
            generate: async () => ({
                output: "",
                toolCalls: [],
            }),
            generateStream: async (input, callbacks) => {
                assert.equal(input.structuredOutputSchema?.jsonSchema?.name, "submit_turn_events");
                assert.equal(input.tools, undefined);
                for (const fragment of fragments) {
                    callbacks?.onTextDelta?.(fragment);
                }
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
        });

        const result = await service.streamTurn({
            userId: base.userId,
            characterId: base.characterId,
            conversationId: base.conversationId,
            userMessageText: "stream me",
            senderActorId: base.userActorId,
            includeAssembledMessages: true,
            onAssembledMessages: (messages) => {
                seenPrompts.push(messages);
            },
            onChunk: (chunk) => {
                seenChunks.push(chunk);
            },
            onTurnEventPreview: (preview) => {
                seenPreviews.push({ eventIndex: preview.eventIndex, eventType: preview.event.type });
            },
        });

        assert.equal(result.model, "m1");
        assert.equal(result.apiKeySource, "user");
        assert.equal(result.output, "Hello World");
        assert.equal(result.turnEvents?.length, 2);
        // Concatenated chunks should reconstruct the assistant text the
        // preview parser saw inside the structured-output JSON stream.
        assert.equal(seenChunks.join(""), "SS: Hello World");
        // We should have received at least the expression event preview once
        // its enclosing event object closed in the JSON stream.
        assert.ok(
            seenPreviews.some(p => p.eventIndex === 1 && p.eventType === "expression"),
            `expected expression preview, got: ${JSON.stringify(seenPreviews)}`,
        );
        assert.equal(seenPrompts.length, 1);

        const messages = fixture.inspect.messages(base.conversationId);
        const assistantMessages = messages.filter(message => message.senderActorId === base.selfActorId);
        assert.equal(assistantMessages.length, 1);
        assert.equal(assistantMessages[0].displayText, "Hello World");
        assert.equal(assistantMessages[0].turnEvents?.length, 2);
    });

    it("streamTurn merges consecutive replyText events and inserts boundary separators on the stream", async () => {
        const fixture = createTestFixture();
        const base = createBaseData();
        fixture.seed.character(base.character);
        fixture.seed.conversation(base.conversation);
        fixture.seed.actor(base.selfActor);
        fixture.seed.actor(base.userActor);
        fixture.seed.userProfile(base.profile);
        seedModelRuntime(fixture, base.userId);

        const seenChunks: string[] = [];

        const structuredObject = {
            events: [
                { type: "replyText", characterId: base.characterId, text: "alpha" },
                { type: "replyText", characterId: base.characterId, text: "beta" },
                { type: "expression", characterId: base.characterId, expression: "neutral" },
                { type: "replyText", characterId: base.characterId, text: "gamma" },
            ],
        };
        const fullJson = JSON.stringify(structuredObject);
        const fragmentSize = 6;
        const fragments: string[] = [];
        for (let i = 0; i < fullJson.length; i += fragmentSize) {
            fragments.push(fullJson.slice(i, i + fragmentSize));
        }

        const modelClient: ModelClient = {
            generate: async () => ({ output: "", toolCalls: [] }),
            generateStream: async (_input, callbacks) => {
                for (const fragment of fragments) {
                    callbacks?.onTextDelta?.(fragment);
                }
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
        });

        const result = await service.streamTurn({
            userId: base.userId,
            characterId: base.characterId,
            conversationId: base.conversationId,
            userMessageText: "stream me",
            senderActorId: base.userActorId,
            onChunk: (chunk) => {
                seenChunks.push(chunk);
            },
        });

        // The two adjacent `alpha` + `beta` replyText events collapse into one;
        // the `expression` between `beta` and `gamma` breaks the run, so the
        // final list keeps three entries (replyText, expression, replyText).
        assert.equal(result.turnEvents?.length, 3);
        assert.equal(result.turnEvents?.[0].type, "replyText");
        assert.equal((result.turnEvents?.[0] as { text: string }).text, "alpha\nbeta");
        assert.equal(result.turnEvents?.[1].type, "expression");
        assert.equal(result.turnEvents?.[2].type, "replyText");
        assert.equal((result.turnEvents?.[2] as { text: string }).text, "gamma");

        // Final canonical display text matches a non-stream render of the same
        // event list (merged blocks + getTurnEventsReplyText join with "\n").
        assert.equal(result.output, "alpha\nbeta\ngamma");

        // Concatenated stream chunks should reproduce the same text, including
        // the boundary separator inserted when crossing replyText events.
        assert.equal(seenChunks.join(""), "alpha\nbeta\ngamma");
    });

    it("chatTurn logs memory write candidates after persisting the assistant turn", async () => {
        const fixture = createTestFixture();
        const base = createBaseData();
        fixture.seed.character(base.character);
        fixture.seed.conversation(base.conversation);
        fixture.seed.actor(base.selfActor);
        fixture.seed.actor(base.userActor);
        fixture.seed.userProfile(base.profile);
        seedModelRuntime(fixture, base.userId);

        const modelClient: ModelClient = {
            generate: async () => ({
                structuredOutput: {
                    events: [
                        {
                            type: "replyText",
                            characterId: base.characterId,
                            text: "hi",
                        },
                    ],
                    memoryWriteCandidates: [
                        {
                            text: "User said their name is Alice.",
                            scope: "user",
                            type: "fact",
                        },
                    ],
                },
                toolCalls: [],
            }),
            generateStream: async () => ({ output: "", toolCalls: [], completed: true }),
            listModels: async () => [],
        };

        const infoLogs: Array<{ message: string; payload?: unknown }> = [];
        const logger = {
            debug: () => { },
            verbose: () => { },
            info: (message: string, payload?: unknown) => { infoLogs.push({ message, payload }); },
            warn: () => { },
            error: () => { },
        };

        const service = new PersonaFlowChatTurnService({
            stores: fixture.stores,
            modelClient,
            logger,
            promptLogger: { writePromptLog: async () => { } },
        });

        const result = await service.chatTurn({
            userId: base.userId,
            characterId: base.characterId,
            conversationId: base.conversationId,
            userMessageText: "hello",
            senderActorId: base.userActorId,
        });

        const memoryLogs = infoLogs.filter(entry => entry.message === "persona-flow/memory: candidates logged");
        assert.equal(memoryLogs.length, 1);
        const payload = memoryLogs[0]?.payload as {
            candidateCount: number;
            assistantMessageId?: string;
            userMessageId?: string;
            modelCallPurpose?: string;
            decision?: string;
        };
        assert.equal(payload.candidateCount, 1);
        assert.equal(payload.assistantMessageId, result.assistantMessageId);
        assert.equal(payload.userMessageId, result.userMessageId);
        assert.equal(payload.modelCallPurpose, "chat.main");
        assert.equal(payload.decision, "logged_only");
    });

    it("chatTurn does not emit memory log when there are no candidates", async () => {
        const fixture = createTestFixture();
        const base = createBaseData();
        fixture.seed.character(base.character);
        fixture.seed.conversation(base.conversation);
        fixture.seed.actor(base.selfActor);
        fixture.seed.actor(base.userActor);
        fixture.seed.userProfile(base.profile);
        seedModelRuntime(fixture, base.userId);

        const modelClient: ModelClient = {
            generate: async () => ({
                structuredOutput: {
                    events: [
                        {
                            type: "replyText",
                            characterId: base.characterId,
                            text: "hi",
                        },
                    ],
                },
                toolCalls: [],
            }),
            generateStream: async () => ({ output: "", toolCalls: [], completed: true }),
            listModels: async () => [],
        };

        const infoLogs: string[] = [];
        const logger = {
            debug: () => { },
            verbose: () => { },
            info: (message: string) => { infoLogs.push(message); },
            warn: () => { },
            error: () => { },
        };

        const service = new PersonaFlowChatTurnService({
            stores: fixture.stores,
            modelClient,
            logger,
            promptLogger: { writePromptLog: async () => { } },
        });

        await service.chatTurn({
            userId: base.userId,
            characterId: base.characterId,
            conversationId: base.conversationId,
            userMessageText: "hello",
            senderActorId: base.userActorId,
        });

        assert.equal(
            infoLogs.filter(message => message === "persona-flow/memory: candidates logged").length,
            0,
        );
    });

    it("chatTurn still succeeds when memory candidate logging throws", async () => {
        const fixture = createTestFixture();
        const base = createBaseData();
        fixture.seed.character(base.character);
        fixture.seed.conversation(base.conversation);
        fixture.seed.actor(base.selfActor);
        fixture.seed.actor(base.userActor);
        fixture.seed.userProfile(base.profile);
        seedModelRuntime(fixture, base.userId);

        const modelClient: ModelClient = {
            generate: async () => ({
                structuredOutput: {
                    events: [
                        {
                            type: "replyText",
                            characterId: base.characterId,
                            text: "hi",
                        },
                    ],
                    memoryWriteCandidates: [
                        {
                            text: "Stable fact.",
                            scope: "user",
                            type: "fact",
                        },
                    ],
                },
                toolCalls: [],
            }),
            generateStream: async () => ({ output: "", toolCalls: [], completed: true }),
            listModels: async () => [],
        };

        let warnCount = 0;
        const logger = {
            debug: () => { },
            verbose: () => { },
            info: () => {
                throw new Error("synthetic logger failure");
            },
            warn: () => { warnCount += 1; },
            error: () => { },
        };

        const service = new PersonaFlowChatTurnService({
            stores: fixture.stores,
            modelClient,
            logger,
            promptLogger: { writePromptLog: async () => { } },
        });

        const result = await service.chatTurn({
            userId: base.userId,
            characterId: base.characterId,
            conversationId: base.conversationId,
            userMessageText: "hello",
            senderActorId: base.userActorId,
        });

        assert.equal(result.output, "hi");
        assert.ok(result.assistantMessageId, "assistant turn should still be persisted");
        assert.ok(warnCount >= 1, "logger.warn should be invoked when info logging fails");
    });

    it("streamTurn logs memory write candidates from structured output", async () => {
        const fixture = createTestFixture();
        const base = createBaseData();
        fixture.seed.character(base.character);
        fixture.seed.conversation(base.conversation);
        fixture.seed.actor(base.selfActor);
        fixture.seed.actor(base.userActor);
        fixture.seed.userProfile(base.profile);
        seedModelRuntime(fixture, base.userId);

        const structuredObject = {
            events: [
                {
                    type: "replyText",
                    characterId: base.characterId,
                    text: "hello",
                },
            ],
            memoryWriteCandidates: [
                {
                    text: "User mentioned a deadline next Friday.",
                    scope: "conversation",
                    type: "event",
                },
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

        const infoLogs: Array<{ message: string; payload?: unknown }> = [];
        const logger = {
            debug: () => { },
            verbose: () => { },
            info: (message: string, payload?: unknown) => { infoLogs.push({ message, payload }); },
            warn: () => { },
            error: () => { },
        };

        const service = new PersonaFlowChatTurnService({
            stores: fixture.stores,
            modelClient,
            logger,
            promptLogger: { writePromptLog: async () => { } },
        });

        const result = await service.streamTurn({
            userId: base.userId,
            characterId: base.characterId,
            conversationId: base.conversationId,
            userMessageText: "stream me",
            senderActorId: base.userActorId,
        });

        const memoryLogs = infoLogs.filter(entry => entry.message === "persona-flow/memory: candidates logged");
        assert.equal(memoryLogs.length, 1);
        const payload = memoryLogs[0]?.payload as {
            candidateCount: number;
            assistantMessageId?: string;
            userMessageId?: string;
            modelCallPurpose?: string;
            decision?: string;
        };
        assert.equal(payload.candidateCount, 1);
        assert.equal(payload.assistantMessageId, result.assistantMessageId);
        assert.equal(payload.userMessageId, result.userMessageId);
        assert.equal(payload.modelCallPurpose, "chat.main");
        assert.equal(payload.decision, "logged_only");
    });

    it("streamTurn keeps candidate text out of the live display stream when JSON is fragmented", async () => {
        const fixture = createTestFixture();
        const base = createBaseData();
        fixture.seed.character(base.character);
        fixture.seed.conversation(base.conversation);
        fixture.seed.actor(base.selfActor);
        fixture.seed.actor(base.userActor);
        fixture.seed.userProfile(base.profile);
        seedModelRuntime(fixture, base.userId);

        // Place memoryWriteCandidates BEFORE events to maximally stress the
        // stream preview parser: candidate text must never become a
        // replyTextDelta even when it arrives first.
        const structuredObject = {
            memoryWriteCandidates: [
                { text: "User mentioned a deadline next Friday.", scope: "conversation", type: "event" },
            ],
            events: [
                { type: "replyText", characterId: base.characterId, text: "Got it." },
            ],
        };
        const fullJson = JSON.stringify(structuredObject);
        // Tiny fragments force partial reads across both the candidate and
        // event boundaries.
        const fragmentSize = 3;
        const fragments: string[] = [];
        for (let i = 0; i < fullJson.length; i += fragmentSize) {
            fragments.push(fullJson.slice(i, i + fragmentSize));
        }

        const seenChunks: string[] = [];

        const modelClient: ModelClient = {
            generate: async () => ({ output: "", toolCalls: [] }),
            generateStream: async (_input, callbacks) => {
                for (const fragment of fragments) {
                    callbacks?.onTextDelta?.(fragment);
                }
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

        const infoLogs: Array<{ message: string; payload?: unknown }> = [];
        const logger = {
            debug: () => { },
            verbose: () => { },
            info: (message: string, payload?: unknown) => { infoLogs.push({ message, payload }); },
            warn: () => { },
            error: () => { },
        };

        const service = new PersonaFlowChatTurnService({
            stores: fixture.stores,
            modelClient,
            logger,
            promptLogger: { writePromptLog: async () => { } },
        });

        const result = await service.streamTurn({
            userId: base.userId,
            characterId: base.characterId,
            conversationId: base.conversationId,
            userMessageText: "stream me",
            senderActorId: base.userActorId,
            onChunk: (chunk) => {
                seenChunks.push(chunk);
            },
        });

        // Streamed display chunks should only reconstruct the assistant
        // reply text, never the candidate text.
        const joined = seenChunks.join("");
        assert.equal(joined, "Got it.");
        assert.ok(
            !joined.includes("deadline"),
            `candidate text leaked into the display stream: ${joined}`,
        );

        // Memory candidates should still be logged after the assistant
        // message id exists.
        const memoryLogs = infoLogs.filter(entry => entry.message === "persona-flow/memory: candidates logged");
        assert.equal(memoryLogs.length, 1);
        const payload = memoryLogs[0]?.payload as {
            candidateCount: number;
            assistantMessageId?: string;
        };
        assert.equal(payload.candidateCount, 1);
        assert.equal(payload.assistantMessageId, result.assistantMessageId);
    });
});
