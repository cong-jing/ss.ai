/**
 * Message store integration tests — SQLiteMessageStore
 */
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { openDatabase, SQLiteMessageStore } from "../src/index.js";
import type { Message } from "@ss-ai/persona-flow";

function makeMessage(overrides?: Partial<Message>): Message {
    return {
        id: crypto.randomUUID(),
        userId: "user_test",
        conversationId: "conv_test",
        role: "user",
        content: "你好",
        createdAt: new Date().toISOString(),
        ...overrides,
    };
}

describe("SQLiteMessageStore", () => {
    let store: SQLiteMessageStore;

    before(() => {
        const { db } = openDatabase(":memory:");
        store = new SQLiteMessageStore(db);
    });

    it("appendMessage and getRecentMessages — round-trips a single message", async () => {
        const msg = makeMessage({ content: "hello" });
        await store.appendMessage(msg);

        const result = await store.getRecentMessages({ userId: msg.userId, conversationId: msg.conversationId, limit: 10 });
        assert.ok(result.some(m => m.id === msg.id), "should find appended message");
    });

    it("getRecentMessages — returns messages in ascending time order", async () => {
        const convId = "conv_order";
        const m1 = makeMessage({ conversationId: convId, createdAt: "2025-01-01T00:00:00.000Z", content: "first" });
        const m2 = makeMessage({ conversationId: convId, createdAt: "2025-01-02T00:00:00.000Z", content: "second" });
        await store.appendMessage(m2);
        await store.appendMessage(m1);

        const result = await store.getRecentMessages({ userId: "user_test", conversationId: convId, limit: 10 });
        assert.equal(result[0].content, "first");
        assert.equal(result[1].content, "second");
    });

    it("getRecentMessages — limit caps the returned count", async () => {
        const convId = "conv_limit";
        for (let i = 0; i < 5; i++) {
            await store.appendMessage(makeMessage({
                conversationId: convId,
                createdAt: new Date(Date.now() + i * 1000).toISOString(),
            }));
        }
        const result = await store.getRecentMessages({ userId: "user_test", conversationId: convId, limit: 3 });
        assert.equal(result.length, 3);
    });

    it("getRecentMessages — isolates by conversationId", async () => {
        await store.appendMessage(makeMessage({ conversationId: "conv_a", content: "from A" }));
        await store.appendMessage(makeMessage({ conversationId: "conv_b", content: "from B" }));

        const a = await store.getRecentMessages({ userId: "user_test", conversationId: "conv_a", limit: 10 });
        assert.ok(a.every(m => m.conversationId === "conv_a"));
    });

    it("getRecentMessages — returns empty array for unknown conversationId", async () => {
        const result = await store.getRecentMessages({ userId: "user_test", conversationId: "conv_unknown_xyz", limit: 10 });
        assert.deepEqual(result, []);
    });
});
