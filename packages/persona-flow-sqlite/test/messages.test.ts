/**
 * Message store integration tests — SQLiteChatStore (message operations)
 */
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { openDatabase, SQLiteConversationStore, SQLiteChatStore } from "../src/index.js";
import type { Conversation, Message } from "@ss-ai/persona-flow";

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
        content: "你好",
        createdAt: new Date().toISOString(),
        ...overrides,
    };
}

describe("SQLiteChatStore — message operations", () => {
    let store: SQLiteChatStore;
    let senderActorId: string;
    const convId = "conv_test_" + crypto.randomUUID();

    before(async () => {
        const { db } = openDatabase(":memory:");
        store = new SQLiteChatStore(db);
        // Create a conversation so we have a real actor ID
        const convStore = new SQLiteConversationStore(db);
        const conv = makeConversation({ id: convId });
        const result = await convStore.createConversation(conv, { selfDisplayName: "AI" });
        senderActorId = result.selfActorId;
    });

    it("appendMessage and getRecentMessages — round-trips a single message", async () => {
        const msg = makeMessage(convId, senderActorId, { content: "hello" });
        await store.appendMessage(msg);

        const result = await store.getRecentMessages({ conversationId: convId, limit: 10 });
        assert.ok(result.some((m: Message) => m.id === msg.id), "should find appended message");
    });

    it("getRecentMessages — returns messages in ascending time order", async () => {
        const cid = "conv_order_" + crypto.randomUUID();
        const { db } = openDatabase(":memory:");
        const localStore = new SQLiteChatStore(db);
        const convStore = new SQLiteConversationStore(db);
        const conv = makeConversation({ id: cid });
        const { selfActorId: pid } = await convStore.createConversation(conv, { selfDisplayName: "AI" });

        const m1 = makeMessage(cid, pid, { createdAt: "2025-01-01T00:00:00.000Z", content: "first" });
        const m2 = makeMessage(cid, pid, { createdAt: "2025-01-02T00:00:00.000Z", content: "second" });
        await localStore.appendMessage(m2);
        await localStore.appendMessage(m1);

        const result = await localStore.getRecentMessages({ conversationId: cid, limit: 10 });
        assert.equal(result[0].content, "first");
        assert.equal(result[1].content, "second");
    });

    it("getRecentMessages — limit caps the returned count", async () => {
        const cid = "conv_limit_" + crypto.randomUUID();
        const { db } = openDatabase(":memory:");
        const localStore = new SQLiteChatStore(db);
        const convStore = new SQLiteConversationStore(db);
        const conv = makeConversation({ id: cid });
        const { selfActorId: pid } = await convStore.createConversation(conv, { selfDisplayName: "AI" });

        for (let i = 0; i < 5; i++) {
            await localStore.appendMessage(makeMessage(cid, pid, {
                createdAt: new Date(Date.now() + i * 1000).toISOString(),
            }));
        }
        const result = await localStore.getRecentMessages({ conversationId: cid, limit: 3 });
        assert.equal(result.length, 3);
    });

    it("getRecentMessages — isolates by conversationId", async () => {
        const { db } = openDatabase(":memory:");
        const localStore = new SQLiteChatStore(db);
        const convStore = new SQLiteConversationStore(db);
        const convA = makeConversation();
        const convB = makeConversation();
        const { selfActorId: pA } = await convStore.createConversation(convA, { selfDisplayName: "AI" });
        const { selfActorId: pB } = await convStore.createConversation(convB, { selfDisplayName: "AI" });

        await localStore.appendMessage(makeMessage(convA.id, pA, { content: "from A" }));
        await localStore.appendMessage(makeMessage(convB.id, pB, { content: "from B" }));

        const a = await localStore.getRecentMessages({ conversationId: convA.id, limit: 10 });
        assert.ok(a.every((m: Message) => m.conversationId === convA.id));
    });

    it("getRecentMessages — returns empty array for unknown conversationId", async () => {
        const result = await store.getRecentMessages({ conversationId: "conv_unknown_xyz", limit: 10 });
        assert.deepEqual(result, []);
    });
});
