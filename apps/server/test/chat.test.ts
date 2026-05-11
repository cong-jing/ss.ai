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
    let char1SelfActorId: string;
    let char1UserActorId: string;

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

        await app.stores.conversationActor.addConversationActor({
            conversationId: char1ConvId,
            role: "self",
            sourceType: "ai_character",
            displayName: char1.displayName ?? char1.name,
            characterId: char1.id,
        });

        const char1Actors = await app.stores.conversationActor.listConversationActors({
            conversationId: char1ConvId,
            activeOnly: true,
        });
        const selfActor = char1Actors.find(actor => actor.role === "self");
        const userActor = char1Actors.find(actor => actor.sourceType === "logged_user");
        assert.ok(selfActor, "expected self actor in test setup");
        assert.ok(userActor, "expected logged_user actor in test setup");
        char1SelfActorId = selfActor.id;
        char1UserActorId = userActor.id;
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

    it("POST /v1/chat/dry-run keeps latest assistant history message", async () => {
        const userMessageContent = "seed user history";
        const assistantMessageContent = "seed assistant history";
        await app.stores.chat.appendMessage({
            id: crypto.randomUUID(),
            conversationId: char1ConvId,
            senderActorId: char1UserActorId,
            content: userMessageContent,
            createdAt: new Date().toISOString(),
        });
        await app.stores.chat.appendMessage({
            id: crypto.randomUUID(),
            conversationId: char1ConvId,
            senderActorId: char1SelfActorId,
            content: assistantMessageContent,
            createdAt: new Date().toISOString(),
        });

        const dryRunRes = await app.agent
            .post("/v1/chat/dry-run")
            .send({ characterId: char1.id, conversationId: char1ConvId, prompt: "new prompt" })
            .expect(200);

        const renderedMessages = dryRunRes.body.messages as Array<{ content: string }>;
        assert.equal(
            renderedMessages.some(message => message.content.includes(assistantMessageContent)),
            true,
            "dry-run prompt should include latest persisted assistant message",
        );
    });

    it("GET /v1/conversations/:id/messages returns 404 for unknown conversation", async () => {
        const res = await app.agent
            .get("/v1/conversations/non-existent/messages")
            .expect(404);
        assert.match(String(res.body?.message ?? ""), /Conversation not found/i);
    });

    it("GET /v1/conversations/:id/messages returns self display name from character displayName", async () => {
        const characterDisplayName = "Display ChatA";
        await app.agent
            .patch(`/v1/characters/${char1.id}`)
            .send({ displayName: characterDisplayName })
            .expect(200);

        const assistantContent = "assistant with display name";
        await app.stores.chat.appendMessage({
            id: crypto.randomUUID(),
            conversationId: char1ConvId,
            senderActorId: char1SelfActorId,
            content: assistantContent,
            createdAt: new Date().toISOString(),
        });

        const res = await app.agent
            .get(`/v1/conversations/${char1ConvId}/messages`)
            .expect(200);

        const target = (res.body.messages as Array<{ content: string; senderDisplayName: string }>).find(
            message => message.content === assistantContent,
        );
        assert.ok(target, "expected seeded assistant message in list");
        assert.equal(target!.senderDisplayName, characterDisplayName);
    });

    it("DELETE /v1/conversations/:id/messages/:messageId deletes a single message", async () => {
        const keepContent = "keep this";
        const deleteContent = "delete this";
        const keepId = crypto.randomUUID();
        const deleteId = crypto.randomUUID();

        await app.stores.chat.appendMessage({
            id: keepId,
            conversationId: char1ConvId,
            senderActorId: char1UserActorId,
            content: keepContent,
            createdAt: new Date().toISOString(),
        });
        await app.stores.chat.appendMessage({
            id: deleteId,
            conversationId: char1ConvId,
            senderActorId: char1UserActorId,
            content: deleteContent,
            createdAt: new Date().toISOString(),
        });

        await app.agent
            .delete(`/v1/conversations/${char1ConvId}/messages/${deleteId}`)
            .expect(200);

        const res = await app.agent
            .get(`/v1/conversations/${char1ConvId}/messages`)
            .expect(200);
        const messages = res.body.messages as Array<{ id: string; content: string }>;

        assert.equal(messages.some(message => message.id === deleteId || message.content === deleteContent), false);
        assert.equal(messages.some(message => message.id === keepId || message.content === keepContent), true);
    });
});
