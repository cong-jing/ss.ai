/**
 * Integration tests for the Character CRUD + active-character API.
 *
 * Uses supertest (in-process, no TCP) + node:test runner.
 * Run via the unified entry: npm test
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import type { Character, ListCharactersResponse } from "@ss-ai/contracts";
import { createTestApp, type TestApp } from "./helpers/testServer.js";

describe("Character CRUD API", () => {
    let app: TestApp;
    let char1: Character;
    let char2: Character;

    before(() => {
        app = createTestApp();
    });

    after(() => {
        app.cleanup();
    });

    // ── List ──────────────────────────────────────────────────────────────────

    it("GET /v1/characters — returns empty list initially", async () => {
        const res = await app.agent.get("/v1/characters").expect(200);
        const data = res.body as ListCharactersResponse;
        assert.deepEqual(data.characters, []);
        assert.equal(data.activeCharacterId, null);
    });

    // ── Create ────────────────────────────────────────────────────────────────

    it("POST /v1/characters — creates Alice with all fields", async () => {
        const res = await app.agent
            .post("/v1/characters")
            .send({ name: "Alice", description: "A curious explorer" })
            .expect(200);
        char1 = res.body as Character;
        assert.equal(typeof char1.id, "string");
        assert.ok(char1.id.length > 0);
        assert.equal(char1.name, "Alice");
        assert.equal(char1.description, "A curious explorer");
        assert.equal(char1.personaPrompt, "");
        assert.equal(char1.greetingMessage, null);
        assert.equal(char1.status, "active");
        assert.equal(typeof char1.createdAt, "string");
        assert.equal(typeof char1.updatedAt, "string");
    });

    it("POST /v1/characters — creates Bob without description", async () => {
        const res = await app.agent
            .post("/v1/characters")
            .send({ name: "Bob" })
            .expect(200);
        char2 = res.body as Character;
        assert.equal(char2.name, "Bob");
        assert.equal(char2.description, "");
    });

    it("POST /v1/characters — rejects empty name with 400", async () => {
        await app.agent.post("/v1/characters").send({ name: "" }).expect(400);
    });

    // ── List after creates ────────────────────────────────────────────────────

    it("GET /v1/characters — lists both characters", async () => {
        const res = await app.agent.get("/v1/characters").expect(200);
        const data = res.body as ListCharactersResponse;
        assert.equal(data.characters.length, 2);
    });

    // ── Get one ───────────────────────────────────────────────────────────────

    it("GET /v1/characters/:id — returns Alice by id", async () => {
        const res = await app.agent.get(`/v1/characters/${char1.id}`).expect(200);
        const data = res.body as Character;
        assert.equal(data.id, char1.id);
        assert.equal(data.name, "Alice");
    });

    it("GET /v1/characters/:id — returns 404 for unknown id", async () => {
        await app.agent.get("/v1/characters/non-existent-id").expect(404);
    });

    // ── Update ────────────────────────────────────────────────────────────────

    it("PATCH /v1/characters/:id — updates description and personaPrompt", async () => {
        const res = await app.agent
            .patch(`/v1/characters/${char1.id}`)
            .send({ description: "Updated description", personaPrompt: "Be curious." })
            .expect(200);
        const data = res.body as Character;
        assert.equal(data.name, "Alice");
        assert.equal(data.description, "Updated description");
        assert.equal(data.personaPrompt, "Be curious.");
        assert.ok(data.updatedAt >= char1.updatedAt, "updatedAt must advance");
        char1 = data; // keep char1 in sync
    });

    it("PATCH /v1/characters/:id — returns 404 for unknown id", async () => {
        await app.agent
            .patch("/v1/characters/non-existent-id")
            .send({ name: "X" })
            .expect(404);
    });

    // ── Active character ──────────────────────────────────────────────────────

    it("GET /v1/active-character — null initially", async () => {
        const res = await app.agent.get("/v1/active-character").expect(200);
        assert.equal(res.body.characterId, null);
    });

    it("POST /v1/active-character — sets Alice as active", async () => {
        const res = await app.agent
            .post("/v1/active-character")
            .send({ characterId: char1.id })
            .expect(200);
        // Response is now { character, conversations, activeConversationId }
        assert.equal(res.body.character.id, char1.id);
        assert.ok(Array.isArray(res.body.conversations));
        assert.equal(typeof res.body.activeConversationId, "string");
    });

    it("GET /v1/active-character — returns Alice id after setting", async () => {
        const res = await app.agent.get("/v1/active-character").expect(200);
        assert.equal(res.body.characterId, char1.id);
    });

    it("GET /v1/characters — activeCharacterId reflected in list response", async () => {
        const res = await app.agent.get("/v1/characters").expect(200);
        const data = res.body as ListCharactersResponse;
        assert.equal(data.activeCharacterId, char1.id);
    });

    it("POST /v1/active-character — returns 404 for unknown id", async () => {
        await app.agent
            .post("/v1/active-character")
            .send({ characterId: "non-existent" })
            .expect(404);
    });

    // ── Delete ────────────────────────────────────────────────────────────────

    it("DELETE /v1/characters/:id — archives Bob with 204", async () => {
        await app.agent.delete(`/v1/characters/${char2.id}`).expect(204);
    });

    it("GET /v1/characters — only Alice remains after delete", async () => {
        const res = await app.agent.get("/v1/characters").expect(200);
        const data = res.body as ListCharactersResponse;
        assert.equal(data.characters.length, 1);
        assert.equal(data.characters[0].id, char1.id);
    });

    it("DELETE /v1/characters/:id — returns 404 for already-archived id", async () => {
        await app.agent.delete(`/v1/characters/${char2.id}`).expect(404);
    });
});

