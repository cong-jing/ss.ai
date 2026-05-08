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

function makeMessage(conversationId: string, overrides?: Partial<Message>): Message {
    return {
        id: crypto.randomUUID(),
        userId: "user_test",
        conversationId,
        role: "user",
        content: "hello",
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
        await store.createConversation(conv);

        const result = await store.getConversationById({ userId: conv.userId, conversationId: conv.id });
        assert.ok(result !== null, "should find the conversation");
        assert.equal(result.id, conv.id);
        assert.equal(result.userId, conv.userId);
        assert.equal(result.characterId, conv.characterId);
        assert.equal(result.title, "我的第一次对话");
        assert.equal(result.createdAt, conv.createdAt);
        assert.equal(result.updatedAt, conv.updatedAt);
    });

    it("getConversationById — returns null for unknown id", async () => {
        const result = await store.getConversationById({ userId: "user_test", conversationId: "no-such-id" });
        assert.equal(result, null);
    });

    it("getConversationById — scoped by userId", async () => {
        const conv = makeConversation({ userId: "user_alice" });
        await store.createConversation(conv);

        // Querying with a different userId should return null
        const result = await store.getConversationById({ userId: "user_bob", conversationId: conv.id });
        assert.equal(result, null);
    });

    it("listConversations — returns all conversations for a character", async () => {
        const charId = "char_list_" + crypto.randomUUID();
        const c1 = makeConversation({ characterId: charId, createdAt: "2025-01-01T00:00:00.000Z" });
        const c2 = makeConversation({ characterId: charId, createdAt: "2025-01-03T00:00:00.000Z" });
        const c3 = makeConversation({ characterId: charId, createdAt: "2025-01-02T00:00:00.000Z" });
        await store.createConversation(c1);
        await store.createConversation(c2);
        await store.createConversation(c3);

        const result = await store.listConversations({ userId: "user_test", characterId: charId });
        assert.equal(result.length, 3);
        // Should be ordered by createdAt DESC
        assert.equal(result[0].id, c2.id, "newest first");
        assert.equal(result[1].id, c3.id);
        assert.equal(result[2].id, c1.id, "oldest last");
    });

    it("listConversations — returns empty array for unknown character", async () => {
        const result = await store.listConversations({ userId: "user_test", characterId: "char_nobody" });
        assert.deepEqual(result, []);
    });

    it("listConversations — isolates by userId", async () => {
        const charId = "char_isolated_" + crypto.randomUUID();
        const convAlice = makeConversation({ userId: "user_alice_iso", characterId: charId });
        const convBob = makeConversation({ userId: "user_bob_iso", characterId: charId });
        await store.createConversation(convAlice);
        await store.createConversation(convBob);

        const aliceList = await store.listConversations({ userId: "user_alice_iso", characterId: charId });
        assert.equal(aliceList.length, 1);
        assert.equal(aliceList[0].id, convAlice.id);
    });

    it("listConversations — isolates by characterId", async () => {
        const userId = "user_chariso_" + crypto.randomUUID();
        const convA = makeConversation({ userId, characterId: "char_x" });
        const convB = makeConversation({ userId, characterId: "char_y" });
        await store.createConversation(convA);
        await store.createConversation(convB);

        const xList = await store.listConversations({ userId, characterId: "char_x" });
        assert.equal(xList.length, 1);
        assert.equal(xList[0].id, convA.id);
    });

    it("deleteConversation — removes the record", async () => {
        const conv = makeConversation();
        await store.createConversation(conv);

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
        await convStore.createConversation(conv);

        // Append two messages to the conversation
        await chatStore.appendMessage(makeMessage(conv.id, { content: "msg 1" }));
        await chatStore.appendMessage(makeMessage(conv.id, { content: "msg 2" }));

        // Confirm messages exist
        const before = await chatStore.getRecentMessages({ userId: conv.userId, conversationId: conv.id, limit: 10 });
        assert.equal(before.length, 2);

        // Delete the conversation
        await convStore.deleteConversation({ userId: conv.userId, conversationId: conv.id });

        // Conversation record should be gone
        const deleted = await convStore.getConversationById({ userId: conv.userId, conversationId: conv.id });
        assert.equal(deleted, null);

        // Messages should also be gone
        const after = await chatStore.getRecentMessages({ userId: conv.userId, conversationId: conv.id, limit: 10 });
        assert.equal(after.length, 0, "messages should have been deleted with the conversation");
    });

    it("deleting one conversation does not affect messages in another", async () => {
        const conv1 = makeConversation({ characterId: "char_cascade2" });
        const conv2 = makeConversation({ characterId: "char_cascade2" });
        await convStore.createConversation(conv1);
        await convStore.createConversation(conv2);

        await chatStore.appendMessage(makeMessage(conv1.id, { content: "from conv1" }));
        await chatStore.appendMessage(makeMessage(conv2.id, { content: "from conv2" }));

        await convStore.deleteConversation({ userId: conv1.userId, conversationId: conv1.id });

        const conv2Messages = await chatStore.getRecentMessages({ userId: conv2.userId, conversationId: conv2.id, limit: 10 });
        assert.equal(conv2Messages.length, 1, "conv2 messages should be unaffected");
        assert.equal(conv2Messages[0].content, "from conv2");
    });
});
