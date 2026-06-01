import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import {
    INTERACTION_MODES,
    InteractionModeValue,
    type Character,
    type InteractionModesResponse,
    type ListCharactersResponse,
    type ListCharacterTemplatesResponse,
} from "@ss-ai/contracts";
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

    it("GET /v1/characters returns empty list initially", async () => {
        const res = await app.agent.get("/v1/characters").expect(200);
        const data = res.body as ListCharactersResponse;
        assert.deepEqual(data.characters, []);
        assert.equal(data.activeCharacterId, null);
    });

    it("POST /v1/characters creates Alice with defaults", async () => {
        const res = await app.agent
            .post("/v1/characters")
            .send({ name: "Alice", description: "A curious explorer" })
            .expect(200);
        char1 = res.body as Character;
        assert.equal(char1.name, "Alice");
        assert.equal(char1.description, "A curious explorer");
        assert.equal(char1.personaPrompt, "");
        assert.equal(char1.greetingMessage, null);
        assert.equal(char1.interactionMode, InteractionModeValue.singleCharacterChat);
        assert.equal(char1.language, "zh-CN");
        assert.equal(char1.status, "active");
    });

    it("POST /v1/characters creates Bob without description", async () => {
        const res = await app.agent.post("/v1/characters").send({ name: "Bob" }).expect(200);
        char2 = res.body as Character;
        assert.equal(char2.name, "Bob");
        assert.equal(char2.description, "");
        assert.equal(char2.language, "zh-CN");
    });

    it("POST /v1/characters rejects empty name", async () => {
        const res = await app.agent.post("/v1/characters").send({ name: "" }).expect(400);
        assert.equal(res.body.code, "character.name_required");
    });

    it("GET /v1/characters lists both characters", async () => {
        const res = await app.agent.get("/v1/characters").expect(200);
        const data = res.body as ListCharactersResponse;
        assert.equal(data.characters.length, 2);
    });

    it("GET /v1/characters/:id returns Alice", async () => {
        const res = await app.agent.get(`/v1/characters/${char1.id}`).expect(200);
        const data = res.body as Character;
        assert.equal(data.id, char1.id);
    });

    it("GET /v1/characters/:id returns 404 for unknown id", async () => {
        await app.agent.get("/v1/characters/non-existent-id").expect(404);
    });

    it("PATCH /v1/characters/:id updates description, personaPrompt and language", async () => {
        const res = await app.agent
            .patch(`/v1/characters/${char1.id}`)
            .send({
                description: "Updated description",
                personaPrompt: "Be curious.",
                language: "en-US",
                interactionMode: InteractionModeValue.groupChat,
            })
            .expect(200);
        const data = res.body as Character;
        assert.equal(data.description, "Updated description");
        assert.equal(data.personaPrompt, "Be curious.");
        assert.equal(data.language, "en-US");
        assert.equal(data.interactionMode, InteractionModeValue.singleCharacterChat);
        char1 = data;
    });

    it("GET /v1/character-interaction-modes returns selectable interaction modes", async () => {
        const res = await app.agent.get("/v1/character-interaction-modes").expect(200);
        const data = res.body as InteractionModesResponse;
        assert.deepEqual(data.interactionModes, [...INTERACTION_MODES]);
    });

    it("GET /v1/character-templates returns localized templates", async () => {
        const res = await app.agent.get("/v1/character-templates?language=ja-JP").expect(200);
        const data = res.body as ListCharacterTemplatesResponse;
        assert.equal(data.templates.length >= 3, true);
        assert.equal(data.templates.every(template => template.language === "ja-JP"), true);
    });

    it("GET /v1/character-templates returns empty list when language is missing", async () => {
        const res = await app.agent.get("/v1/character-templates").expect(200);
        const data = res.body as ListCharacterTemplatesResponse;
        assert.deepEqual(data.templates, []);
    });

    it("PATCH /v1/characters/:id returns 404 for unknown id", async () => {
        await app.agent.patch("/v1/characters/non-existent-id").send({ name: "X" }).expect(404);
    });

    it("GET /v1/active-character is null initially", async () => {
        const res = await app.agent.get("/v1/active-character").expect(200);
        assert.equal(res.body.characterId, null);
    });

    it("POST /v1/active-character sets Alice as active", async () => {
        const res = await app.agent.post("/v1/active-character").send({ characterId: char1.id }).expect(200);
        assert.equal(res.body.character.id, char1.id);
        assert.ok(Array.isArray(res.body.conversations));
    });

    it("GET /v1/active-character returns Alice id after setting", async () => {
        const res = await app.agent.get("/v1/active-character").expect(200);
        assert.equal(res.body.characterId, char1.id);
    });

    it("GET /v1/characters includes activeCharacterId", async () => {
        const res = await app.agent.get("/v1/characters").expect(200);
        const data = res.body as ListCharactersResponse;
        assert.equal(data.activeCharacterId, char1.id);
    });

    it("POST /v1/active-character returns 404 for unknown id", async () => {
        await app.agent.post("/v1/active-character").send({ characterId: "non-existent" }).expect(404);
    });

    it("DELETE /v1/characters/:id archives Bob", async () => {
        await app.agent.delete(`/v1/characters/${char2.id}`).expect(204);
    });

    it("GET /v1/characters only returns Alice after delete", async () => {
        const res = await app.agent.get("/v1/characters").expect(200);
        const data = res.body as ListCharactersResponse;
        assert.equal(data.characters.length, 1);
        assert.equal(data.characters[0].id, char1.id);
    });

    it("DELETE /v1/characters/:id returns 404 for archived id", async () => {
        await app.agent.delete(`/v1/characters/${char2.id}`).expect(404);
    });
});
