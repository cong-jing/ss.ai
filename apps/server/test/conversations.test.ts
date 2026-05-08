/**
 * Integration tests for Conversation management APIs.
 *
 * Endpoints covered:
 *   GET  /v1/characters/:id/conversations
 *   POST /v1/characters/:id/conversations
 *   POST /v1/characters/:id/active-conversation
 *   DELETE /v1/characters/:id/conversations/:convId
 *   POST /v1/active-character  (now includes conversations in response)
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import type {
    Character,
    ListConversationsResponse,
    CreateConversationResponse,
    SelectConversationResponse,
    DeleteConversationResponse,
    SetActiveCharacterResponse,
} from "@ss-ai/contracts";
import { createTestApp, type TestApp } from "./helpers/testServer.js";

describe("Conversation management API", () => {
    let app: TestApp;
    let char: Character;
    let char2: Character;

    before(async () => {
        app = createTestApp();
        // Create two characters (each auto-creates one conversation)
        const r1 = await app.agent.post("/v1/characters").send({ name: "ConvTestChar" });
        char = r1.body as Character;
        const r2 = await app.agent.post("/v1/characters").send({ name: "ConvTestChar2" });
        char2 = r2.body as Character;
    });

    after(() => {
        app.cleanup();
    });

    // ── Initial state ─────────────────────────────────────────────────────────

    it("POST /v1/characters auto-creates one conversation", async () => {
        const res = await app.agent
            .get(`/v1/characters/${char.id}/conversations`)
            .expect(200);
        const data = res.body as ListConversationsResponse;
        assert.equal(data.conversations.length, 1);
        assert.equal(typeof data.conversations[0].id, "string");
        assert.equal(typeof data.conversations[0].createdAt, "string");
        assert.equal(typeof data.conversations[0].updatedAt, "string");
        assert.equal(typeof data.activeConversationId, "string");
        assert.equal(data.activeConversationId, data.conversations[0].id);
    });

    it("GET /v1/characters/:id/conversations — returns 404 for unknown character", async () => {
        await app.agent.get("/v1/characters/non-existent/conversations").expect(404);
    });

    // ── SetActiveCharacter returns conversations ───────────────────────────────

    it("POST /v1/active-character — response includes character + conversations", async () => {
        const res = await app.agent
            .post("/v1/active-character")
            .send({ characterId: char.id })
            .expect(200);
        const data = res.body as SetActiveCharacterResponse;
        assert.equal(data.character.id, char.id);
        assert.ok(Array.isArray(data.conversations));
        assert.equal(data.conversations.length, 1);
        assert.equal(typeof data.activeConversationId, "string");
    });

    // ── Create conversation ───────────────────────────────────────────────────

    it("POST /v1/characters/:id/conversations — creates a new conversation", async () => {
        const res = await app.agent
            .post(`/v1/characters/${char.id}/conversations`)
            .expect(200);
        const data = res.body as CreateConversationResponse;
        assert.equal(typeof data.conversationId, "string");
        assert.ok(data.conversationId.length > 0);
        assert.equal(data.conversations.length, 2);
        assert.equal(data.activeConversationId, data.conversationId);
    });

    it("GET /v1/characters/:id/conversations — returns updated list after create", async () => {
        const res = await app.agent
            .get(`/v1/characters/${char.id}/conversations`)
            .expect(200);
        const data = res.body as ListConversationsResponse;
        assert.equal(data.conversations.length, 2);
        // Newest first
        assert.ok(data.conversations[0].createdAt >= data.conversations[1].createdAt);
    });

    it("POST /v1/characters/:id/conversations — returns 404 for unknown character", async () => {
        await app.agent.post("/v1/characters/non-existent/conversations").expect(404);
    });

    // ── Select conversation ───────────────────────────────────────────────────

    it("POST /v1/characters/:id/active-conversation — switches to an existing conversation", async () => {
        const listRes = await app.agent.get(`/v1/characters/${char.id}/conversations`);
        const { conversations } = listRes.body as ListConversationsResponse;
        // Switch to the older (last in list)
        const older = conversations[1];

        const res = await app.agent
            .post(`/v1/characters/${char.id}/active-conversation`)
            .send({ conversationId: older.id })
            .expect(200);
        const data = res.body as SelectConversationResponse;
        assert.equal(data.conversationId, older.id);
        assert.equal(data.conversations.length, 2);

        // Verify it persisted
        const check = await app.agent.get(`/v1/characters/${char.id}/conversations`);
        assert.equal((check.body as ListConversationsResponse).activeConversationId, older.id);
    });

    it("POST /v1/characters/:id/active-conversation — returns 400 for non-existent conversationId", async () => {
        await app.agent
            .post(`/v1/characters/${char.id}/active-conversation`)
            .send({ conversationId: "does-not-exist" })
            .expect(400);
    });

    // ── Delete conversation ───────────────────────────────────────────────────

    it("DELETE /v1/characters/:id/conversations/:convId — deletes inactive conversation", async () => {
        const listRes = await app.agent.get(`/v1/characters/${char.id}/conversations`);
        const { conversations, activeConversationId } = listRes.body as ListConversationsResponse;
        assert.equal(conversations.length, 2);

        // Find the non-active one to delete
        const inactive = conversations.find(c => c.id !== activeConversationId)!;

        const res = await app.agent
            .delete(`/v1/characters/${char.id}/conversations/${inactive.id}`)
            .expect(200);
        const data = res.body as DeleteConversationResponse;
        assert.equal(data.conversations.length, 1);
        assert.ok(!data.conversations.some(c => c.id === inactive.id));
        // Active conversation unchanged
        assert.equal(data.activeConversationId, activeConversationId);
    });

    it("DELETE /v1/characters/:id/conversations/:convId — auto-switches when active is deleted", async () => {
        // Create a second conversation so we can delete the active one
        const createRes = await app.agent
            .post(`/v1/characters/${char.id}/conversations`)
            .expect(200);
        const { conversationId: newId } = createRes.body as CreateConversationResponse;

        const listRes = await app.agent.get(`/v1/characters/${char.id}/conversations`);
        const { activeConversationId } = listRes.body as ListConversationsResponse;
        assert.equal(activeConversationId, newId); // newest is active

        const res = await app.agent
            .delete(`/v1/characters/${char.id}/conversations/${activeConversationId!}`)
            .expect(200);
        const data = res.body as DeleteConversationResponse;
        // Auto-switched to the remaining conversation
        assert.ok(data.activeConversationId !== activeConversationId);
        assert.ok(data.activeConversationId !== null);
        assert.equal(data.conversations.length, 1);
    });

    it("DELETE — auto-creates new conversation when last one is deleted", async () => {
        // Verify char has exactly 1 conversation at this point
        const listBefore = await app.agent.get(`/v1/characters/${char.id}/conversations`);
        assert.equal((listBefore.body as ListConversationsResponse).conversations.length, 1);
        const { activeConversationId } = listBefore.body as ListConversationsResponse;

        const res = await app.agent
            .delete(`/v1/characters/${char.id}/conversations/${activeConversationId!}`)
            .expect(200);
        const data = res.body as DeleteConversationResponse;
        // Should auto-create a replacement
        assert.equal(data.conversations.length, 1);
        assert.ok(data.activeConversationId !== null);
        assert.equal(data.conversations[0].id, data.activeConversationId);
    });

    // ── Isolation between characters ──────────────────────────────────────────

    it("conversations are isolated per character", async () => {
        // char2 should still have only its original conversation
        const res = await app.agent
            .get(`/v1/characters/${char2.id}/conversations`)
            .expect(200);
        const data = res.body as ListConversationsResponse;
        assert.equal(data.conversations.length, 1);
    });
});
