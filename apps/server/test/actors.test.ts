import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import type { Character, ListConversationsResponse, ConversationActor } from "@ss-ai/contracts";
import { createTestApp, type TestApp } from "./helpers/testServer.js";

describe("Conversation actor API", () => {
    let app: TestApp;
    let char: Character;
    let conversationId: string;

    before(async () => {
        app = createTestApp();
        const characterRes = await app.agent.post("/v1/characters").send({ name: "ActorTestChar" }).expect(200);
        char = characterRes.body as Character;

        const listRes = await app.agent
            .get(`/v1/characters/${char.id}/conversations`)
            .expect(200);
        conversationId = (listRes.body as ListConversationsResponse).conversations[0].id;
    });

    after(() => {
        app.cleanup();
    });

    it("GET /v1/conversations/:id/actors includes default logged user actor", async () => {
        const res = await app.agent.get(`/v1/conversations/${conversationId}/actors`).expect(200);
        const actors = (res.body as { actors: ConversationActor[] }).actors;

        const defaultUserActor = actors.find(a => a.sourceType === "logged_user" && a.userProfileId === "default");
        assert.ok(defaultUserActor, "default logged_user actor should exist");
        assert.equal(defaultUserActor?.displayName.length ? true : false, true);
    });

    it("POST /v1/conversations/:id/actors creates a local actor", async () => {
        const res = await app.agent
            .post(`/v1/conversations/${conversationId}/actors`)
            .send({ displayName: "Alice", profileSnapshotJson: '{"bio":"hello"}' })
            .expect(200);

        const actor = (res.body as { actor: ConversationActor }).actor;
        assert.equal(actor.displayName, "Alice");
        assert.equal(actor.sourceType, "local_actor");
        assert.equal(actor.profileSnapshotJson, '{"bio":"hello"}');
    });

    it("PATCH /v1/conversations/:id/actors/:actorId updates a local actor", async () => {
        const createRes = await app.agent
            .post(`/v1/conversations/${conversationId}/actors`)
            .send({ displayName: "Bob" })
            .expect(200);
        const created = (createRes.body as { actor: ConversationActor }).actor;

        const updateRes = await app.agent
            .patch(`/v1/conversations/${conversationId}/actors/${created.id}`)
            .send({ displayName: "Bob v2", profileSnapshotJson: '{"mood":"friendly"}' })
            .expect(200);
        const updated = (updateRes.body as { actor: ConversationActor }).actor;

        assert.equal(updated.id, created.id);
        assert.equal(updated.displayName, "Bob v2");
        assert.equal(updated.profileSnapshotJson, '{"mood":"friendly"}');
    });

    it("PATCH /v1/conversations/:id/actors/:actorId rejects editing default logged_user actor", async () => {
        const listRes = await app.agent.get(`/v1/conversations/${conversationId}/actors`).expect(200);
        const actors = (listRes.body as { actors: ConversationActor[] }).actors;
        const defaultUserActor = actors.find(a => a.sourceType === "logged_user" && a.userProfileId === "default");
        assert.ok(defaultUserActor);

        await app.agent
            .patch(`/v1/conversations/${conversationId}/actors/${defaultUserActor!.id}`)
            .send({ displayName: "Cannot Edit" })
            .expect(400);
    });

    it("DELETE /v1/conversations/:id/actors/:actorId removes a local actor from active list", async () => {
        const createRes = await app.agent
            .post(`/v1/conversations/${conversationId}/actors`)
            .send({ displayName: "Temp Actor" })
            .expect(200);
        const actorId = (createRes.body as { actor: ConversationActor }).actor.id;

        await app.agent
            .delete(`/v1/conversations/${conversationId}/actors/${actorId}`)
            .expect(200);

        const listRes = await app.agent.get(`/v1/conversations/${conversationId}/actors`).expect(200);
        const actors = (listRes.body as { actors: ConversationActor[] }).actors;
        assert.equal(actors.some(a => a.id === actorId), false);
    });
});
