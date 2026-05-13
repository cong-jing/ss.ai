import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Character, Conversation, ConversationActor, PersonaFlowModelService, UserProfile } from "../src/index.js";
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

describe("persona-flow chat turn service", () => {
    it("chatTurn skips assistant append when structured output action=skip", async () => {
        const fixture = createTestFixture();
        const base = createBaseData();
        fixture.seed.character(base.character);
        fixture.seed.conversation(base.conversation);
        fixture.seed.actor(base.selfActor);
        fixture.seed.actor(base.userActor);
        fixture.seed.userProfile(base.profile);

        const service = new PersonaFlowChatTurnService({
            stores: fixture.stores,
            getModelServiceForUser: async () => ({
                chat: async () => ({
                    requestId: "r1",
                    model: "m1",
                    mode: "structured",
                    output: "",
                    structuredOutput: {
                        action: "skip",
                        replyText: "",
                        control: {
                            summarizeSuggested: false,
                            summarizeReason: "",
                            summarizeUrgency: "none",
                        },
                        skip: {
                            reasonCode: "other",
                            reason: "test",
                        },
                    },
                    toolCalls: [],
                }),
                chatStream: async () => ({
                    requestId: "rs",
                    model: "m1",
                    mode: "non-structured",
                    output: "",
                    toolCalls: [],
                    completed: true,
                }),
            }),
        });

        const result = await service.chatTurn({
            userId: base.userId,
            characterId: base.characterId,
            conversationId: base.conversationId,
            userMessageText: "hello",
            llmResponseMode: "structured",
            senderActorId: base.userActorId,
        });

        assert.equal(result.output, "");
        assert.equal(result.assistantMessageId, undefined);

        const messages = fixture.inspect.messages(base.conversationId);
        const assistantMessages = messages.filter(message => message.senderActorId === base.selfActorId);
        assert.equal(assistantMessages.length, 0);
    });

    it("streamTurn emits normalized chunks and persists assistant message", async () => {
        const fixture = createTestFixture();
        const base = createBaseData();
        fixture.seed.character(base.character);
        fixture.seed.conversation(base.conversation);
        fixture.seed.actor(base.selfActor);
        fixture.seed.actor(base.userActor);
        fixture.seed.userProfile(base.profile);

        const seenChunks: string[] = [];
        const seenPrompts: Array<Array<{ role: "system" | "user" | "assistant"; content: string }>> = [];

        const service = new PersonaFlowChatTurnService({
            stores: fixture.stores,
            getModelServiceForUser: async () => ({
                chat: async () => ({
                    requestId: "r1",
                    model: "m1",
                    mode: "structured",
                    output: "unused",
                    toolCalls: [],
                }),
                chatStream: async (request) => {
                    request.onTextDelta?.("p1[SS]: Hello ");
                    request.onTextDelta?.("World");
                    return {
                        requestId: "rs",
                        model: "m-stream",
                        mode: "non-structured",
                        output: "p1[SS]: Hello World",
                        toolCalls: [],
                        completed: true,
                        streamCompleted: true,
                    } as ReturnType<PersonaFlowModelService["chatStream"]> extends Promise<infer T> ? T : never;
                },
            }),
        });

        const result = await service.streamTurn({
            userId: base.userId,
            characterId: base.characterId,
            conversationId: base.conversationId,
            userMessageText: "stream me",
            llmResponseMode: "non-structured",
            senderActorId: base.userActorId,
            includeAssembledMessages: true,
            onAssembledMessages: (messages) => {
                seenPrompts.push(messages);
            },
            onChunk: (chunk) => {
                seenChunks.push(chunk);
            },
        });

        assert.equal(result.model, "m-stream");
        assert.equal(result.output, "Hello World");
        assert.equal(seenChunks.join(""), "Hello World");
        assert.equal(seenPrompts.length, 1);

        const messages = fixture.inspect.messages(base.conversationId);
        const assistantMessages = messages.filter(message => message.senderActorId === base.selfActorId);
        assert.equal(assistantMessages.length, 1);
        assert.equal(assistantMessages[0].content, "Hello World");
    });
});
