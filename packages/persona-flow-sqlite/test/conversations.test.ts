/**
 * Conversation store integration tests — SQLiteConversationStore
 *
 * Uses a fresh in-memory SQLite database per describe block so tests are
 * hermetic and leave no files on disk.
 */
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { openDatabase, SQLiteConversationStore, SQLiteChatStore } from "../src/index.js";
import type { Conversation, Message } from "@ss-ai/persona-flow";

// ── fixtures ──────────────────────────────────────────────────────────────────

function makeConversation(overrides?: Partial<Conversation>): Conversation {
    return {
        id: crypto.randomUUID(),
        userId: "user_test",
        characterId: "char_a",
        title: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        ...overrides,
    };
}

function makeMessage(conversationId: string, senderActorId: string, overrides?: Partial<Message>): Message {
    return {
        id: crypto.randomUUID(),
        conversationId,
        senderActorId,
        kind: "user_text",
        displayText: "hello",
        createdAt: new Date().toISOString(),
        ...overrides,
    };
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe("SQLiteConversationStore", () => {
    let store: SQLiteConversationStore;

    before(() => {
        const { db } = openDatabase(":memory:");
        store = new SQLiteConversationStore(db);
    });

    it("createConversation — inserts and can be retrieved by id", async () => {
        const conv = makeConversation({ title: "我的第一次对话" });
        await store.createConversation(conv, { selfDisplayName: "小铃" });

        const result = await store.getConversationById({ userId: conv.userId, conversationId: conv.id });
        assert.ok(result !== null, "should find the conversation");
        assert.equal(result.id, conv.id);
        assert.equal(result.title, "我的第一次对话");
    });

    it("createConversation — returns selfActorId and systemActorId", async () => {
        const conv = makeConversation();
        const result = await store.createConversation(conv, { selfDisplayName: "AI" });
        assert.ok(result.selfActorId, "should have selfActorId");
        assert.ok(result.systemActorId, "should have systemActorId");
        assert.notEqual(result.selfActorId, result.systemActorId);
    });

    it("getConversationById — returns null for unknown id", async () => {
        const result = await store.getConversationById({ userId: "user_test", conversationId: "no-such-id" });
        assert.equal(result, null);
    });

    it("getConversationById — scoped by userId", async () => {
        const conv = makeConversation({ userId: "user_alice" });
        await store.createConversation(conv, { selfDisplayName: "AI" });
        const result = await store.getConversationById({ userId: "user_bob", conversationId: conv.id });
        assert.equal(result, null);
    });

    it("listConversations — returns all conversations for a character", async () => {
        const charId = "char_list_" + crypto.randomUUID();
        const c1 = makeConversation({ characterId: charId, createdAt: "2025-01-01T00:00:00.000Z" });
        const c2 = makeConversation({ characterId: charId, createdAt: "2025-01-03T00:00:00.000Z" });
        const c3 = makeConversation({ characterId: charId, createdAt: "2025-01-02T00:00:00.000Z" });
        await store.createConversation(c1, { selfDisplayName: "AI" });
        await store.createConversation(c2, { selfDisplayName: "AI" });
        await store.createConversation(c3, { selfDisplayName: "AI" });

        const result = await store.listConversations({ userId: "user_test", characterId: charId });
        assert.equal(result.length, 3);
        assert.equal(result[0].id, c2.id, "newest first");
        assert.equal(result[2].id, c1.id, "oldest last");
    });

    it("listConversations — returns empty array for unknown character", async () => {
        const result = await store.listConversations({ userId: "user_test", characterId: "char_nobody" });
        assert.deepEqual(result, []);
    });

    it("deleteConversation — removes the record", async () => {
        const conv = makeConversation();
        await store.createConversation(conv, { selfDisplayName: "AI" });
        await store.deleteConversation({ userId: conv.userId, conversationId: conv.id });
        const result = await store.getConversationById({ userId: conv.userId, conversationId: conv.id });
        assert.equal(result, null, "should be deleted");
    });

    it("deleteConversation — is a no-op for unknown id (does not throw)", async () => {
        await assert.doesNotReject(() =>
            store.deleteConversation({ userId: "user_test", conversationId: "no-such-conv" }),
        );
    });
});

describe("SQLiteConversationStore — deleteConversation cascades to messages", () => {
    let convStore: SQLiteConversationStore;
    let chatStore: SQLiteChatStore;

    before(() => {
        const { db } = openDatabase(":memory:");
        convStore = new SQLiteConversationStore(db);
        chatStore = new SQLiteChatStore(db);
    });

    it("deleting a conversation also removes its messages", async () => {
        const conv = makeConversation({ characterId: "char_cascade" });
        const { selfActorId } = await convStore.createConversation(conv, { selfDisplayName: "AI" });

        await chatStore.appendMessage(makeMessage(conv.id, selfActorId, { displayText: "msg 1" }));
        await chatStore.appendAssistantTurn({
            message: makeMessage(conv.id, selfActorId, {
                kind: "assistant_turn_events",
                displayText: "msg 2",
            }),
            events: [{ type: "replyText", characterId: conv.characterId, text: "msg 2" }],
        });

        const before = await chatStore.getRecentMessages({ conversationId: conv.id, limit: 10 });
        assert.equal(before.length, 2);

        await convStore.deleteConversation({ userId: conv.userId, conversationId: conv.id });

        const deleted = await convStore.getConversationById({ userId: conv.userId, conversationId: conv.id });
        assert.equal(deleted, null);

        const after = await chatStore.getRecentMessages({ conversationId: conv.id, limit: 10 });
        assert.equal(after.length, 0, "messages should have been deleted with the conversation");
    });

    it("deleting one conversation does not affect messages in another", async () => {
        const conv1 = makeConversation({ characterId: "char_cascade2" });
        const conv2 = makeConversation({ characterId: "char_cascade2" });
        const { selfActorId: p1 } = await convStore.createConversation(conv1, { selfDisplayName: "AI" });
        const { selfActorId: p2 } = await convStore.createConversation(conv2, { selfDisplayName: "AI" });

        await chatStore.appendMessage(makeMessage(conv1.id, p1, { displayText: "from conv1" }));
        await chatStore.appendMessage(makeMessage(conv2.id, p2, { displayText: "from conv2" }));

        await convStore.deleteConversation({ userId: conv1.userId, conversationId: conv1.id });

        const conv2Messages = await chatStore.getRecentMessages({ conversationId: conv2.id, limit: 10 });
        assert.equal(conv2Messages.length, 1, "conv2 messages should be unaffected");
        assert.equal(conv2Messages[0].displayText, "from conv2");
    });
});
