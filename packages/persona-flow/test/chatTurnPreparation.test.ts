import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Character, Conversation, ConversationActor, UserProfile } from "../src/index.js";
import { PersonaFlowTurnError, prepareChatTurnContext } from "../src/index.js";
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

describe("persona-flow chat turn preparation", () => {
    it("throws 404 when conversation does not exist", async () => {
        const fixture = createTestFixture();
        const base = createBaseData();
        fixture.seed.character(base.character);
        fixture.seed.actor(base.selfActor);
        fixture.seed.userProfile(base.profile);

        await assert.rejects(
            () => prepareChatTurnContext({
                stores: fixture.stores,
                userId: base.userId,
                characterId: base.characterId,
                conversationId: "missing-conv",
                userMessageText: "hello",
                llmResponseMode: "structured",
                senderActorId: base.userActorId,
                persistUserMessage: false,
            }),
            (error: unknown) => {
                assert.ok(error instanceof PersonaFlowTurnError);
                assert.equal(error.status, 404);
                assert.match(error.message, /Conversation not found/i);
                return true;
            },
        );
    });

    it("throws 404 when conversation does not belong to character", async () => {
        const fixture = createTestFixture();
        const base = createBaseData();
        fixture.seed.character(base.character);
        fixture.seed.conversation({ ...base.conversation, characterId: "other-char" });
        fixture.seed.actor(base.selfActor);
        fixture.seed.actor(base.userActor);
        fixture.seed.userProfile(base.profile);

        await assert.rejects(
            () => prepareChatTurnContext({
                stores: fixture.stores,
                userId: base.userId,
                characterId: base.characterId,
                conversationId: base.conversationId,
                userMessageText: "hello",
                llmResponseMode: "structured",
                senderActorId: base.userActorId,
                persistUserMessage: false,
            }),
            (error: unknown) => {
                assert.ok(error instanceof PersonaFlowTurnError);
                assert.equal(error.status, 404);
                assert.match(error.message, /Conversation not found for character/i);
                return true;
            },
        );
    });

    it("dry-run prompt keeps latest assistant history message", async () => {
        const fixture = createTestFixture();
        const base = createBaseData();
        fixture.seed.character(base.character);
        fixture.seed.conversation(base.conversation);
        fixture.seed.actor(base.selfActor);
        fixture.seed.actor(base.userActor);
        fixture.seed.userProfile(base.profile);

        await fixture.seed.message({
            id: crypto.randomUUID(),
            conversationId: base.conversationId,
            senderActorId: base.userActorId,
            content: "seed user history",
            createdAt: nowIso(),
        });
        const assistantMessageContent = "seed assistant history";
        await fixture.seed.message({
            id: crypto.randomUUID(),
            conversationId: base.conversationId,
            senderActorId: base.selfActorId,
            content: assistantMessageContent,
            createdAt: nowIso(),
        });

        const prepared = await prepareChatTurnContext({
            stores: fixture.stores,
            userId: base.userId,
            characterId: base.characterId,
            conversationId: base.conversationId,
            userMessageText: "new prompt",
            llmResponseMode: "structured",
            senderActorId: base.userActorId,
            persistUserMessage: false,
        });

        assert.equal(
            prepared.rendered.messages.some(message => message.content.includes(assistantMessageContent)),
            true,
        );
    });
});
