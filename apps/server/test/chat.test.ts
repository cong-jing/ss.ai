import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import type { Character, ListConversationsResponse } from "@ss-ai/contracts";
import { createTestApp, type TestApp } from "./helpers/testServer.js";

describe("Chat API target validation", () => {
    let app: TestApp;
    let char1: Character;
    let char2: Character;
    let char1ConvId: string;
    let char2ConvId: string;

    before(async () => {
        app = createTestApp();

        const r1 = await app.agent.post("/v1/characters").send({ name: "ChatA" }).expect(200);
        char1 = r1.body as Character;

        const r2 = await app.agent.post("/v1/characters").send({ name: "ChatB" }).expect(200);
        char2 = r2.body as Character;

        const list1 = await app.agent.get(`/v1/characters/${char1.id}/conversations`).expect(200);
        char1ConvId = (list1.body as ListConversationsResponse).conversations[0].id;

        const list2 = await app.agent.get(`/v1/characters/${char2.id}/conversations`).expect(200);
        char2ConvId = (list2.body as ListConversationsResponse).conversations[0].id;
    });

    after(() => {
        app.cleanup();
    });

    it("POST /v1/chat returns 400 when characterId is missing", async () => {
        const res = await app.agent
            .post("/v1/chat")
            .send({ conversationId: char1ConvId, prompt: "hello" })
            .expect(400);
        assert.match(String(res.body?.message ?? ""), /characterId is required/i);
    });

    it("POST /v1/chat returns 400 when conversationId is missing", async () => {
        const res = await app.agent
            .post("/v1/chat")
            .send({ characterId: char1.id, prompt: "hello" })
            .expect(400);
        assert.match(String(res.body?.message ?? ""), /conversationId is required/i);
    });

    it("POST /v1/chat returns 404 when conversation does not exist", async () => {
        const res = await app.agent
            .post("/v1/chat")
            .send({ characterId: char1.id, conversationId: "conv-not-found", prompt: "hello" })
            .expect(404);
        assert.match(String(res.body?.message ?? ""), /Conversation not found/i);
    });

    it("POST /v1/chat returns 404 when conversation does not belong to character", async () => {
        const res = await app.agent
            .post("/v1/chat")
            .send({ characterId: char1.id, conversationId: char2ConvId, prompt: "hello" })
            .expect(404);
        assert.match(String(res.body?.message ?? ""), /Conversation not found for character/i);
    });

    it("POST /v1/chat/stream returns 400 when required ids are missing", async () => {
        const res = await app.agent
            .post("/v1/chat/stream")
            .send({ prompt: "hello" })
            .expect(400);
        assert.match(String(res.body?.message ?? ""), /(characterId|conversationId) is required/i);
    });

    it("POST /v1/chat/dry-run returns 404 on mismatched character/conversation", async () => {
        const res = await app.agent
            .post("/v1/chat/dry-run")
            .send({ characterId: char1.id, conversationId: char2ConvId, prompt: "hello" })
            .expect(404);
        assert.match(String(res.body?.message ?? ""), /Conversation not found for character/i);
    });

    it("GET /v1/conversations/:id/messages returns 404 for unknown conversation", async () => {
        const res = await app.agent
            .get("/v1/conversations/non-existent/messages")
            .expect(404);
        assert.match(String(res.body?.message ?? ""), /Conversation not found/i);
    });
});
