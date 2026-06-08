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
                assert.equal(input.tools?.[0]?.name, "submit_turn_events");
                assert.deepEqual(input.toolChoice, {
                    type: "function",
                    functionName: "submit_turn_events",
                });

                return {
                    output: "",
                    toolCalls: [
                        {
                            functionName: "submit_turn_events",
                            arguments: {
                                events: [
                                    {
                                        type: "replyText",
                                        characterId: base.characterId,
                                        text: "SS: hello back",
                                    },
                                ],
                            },
                        },
                    ],
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

    it("streamTurn drives chunks from submit_turn_events tool-call deltas and persists assistant message", async () => {
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

        // Pre-compute the full arguments string and slice it into fragments so we
        // can simulate provider-side streaming of tool-call argument deltas.
        const fullArgs = JSON.stringify({
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
        });
        const fragmentSize = 8;
        const fragments: string[] = [];
        for (let i = 0; i < fullArgs.length; i += fragmentSize) {
            fragments.push(fullArgs.slice(i, i + fragmentSize));
        }

        const modelClient: ModelClient = {
            generate: async () => ({
                output: "",
                toolCalls: [],
            }),
            generateStream: async (input, callbacks) => {
                assert.equal(input.tools?.[0]?.name, "submit_turn_events");
                // First delta announces the tool/function name.
                callbacks?.onToolCallDelta?.({
                    index: 0,
                    id: "call_test",
                    type: "function",
                    functionNameDelta: "submit_turn_events",
                });
                for (const fragment of fragments) {
                    callbacks?.onToolCallDelta?.({
                        index: 0,
                        argumentsDelta: fragment,
                    });
                }
                const toolCall = {
                    id: "call_test",
                    type: "function",
                    index: 0,
                    functionName: "submit_turn_events",
                    arguments: fullArgs,
                };
                callbacks?.onToolCall?.(toolCall);
                return {
                    output: "",
                    toolCalls: [toolCall],
                    completed: true,
                    finishReason: "tool_calls",
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
        // Concatenated chunks should reconstruct the full assistant text the
        // preview parser saw inside the tool-call arguments stream.
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
});
