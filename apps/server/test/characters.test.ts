/**
 * Integration tests for the Character CRUD API.
 *
 * Uses Node.js built-in test runner (node:test) — no extra packages needed.
 * Run via the unified entry: npm test
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import type { Character, ListCharactersResponse } from "@ss-ai/contracts";
import { startTestServer, type TestServer } from "./helpers/testServer.js";
import { httpRequest } from "./helpers/http.js";

describe("Character CRUD API", () => {
    let server: TestServer;

    // Shared state — tests run sequentially within a describe block
    let char1: Character;
    let char2: Character;

    before(async () => {
        server = await startTestServer();
    });

    after(() => {
        server.cleanup();
    });

    // ── List ─────────────────────────────────────────────────────────────────

    it("GET /v1/characters — returns empty list initially", async () => {
        const { status, data } = await httpRequest<ListCharactersResponse>(server.base, "GET", "/v1/characters");
        assert.equal(status, 200);
        assert.deepEqual(data.characters, []);
        assert.equal(data.activeCharacterId, null);
    });

    // ── Create ────────────────────────────────────────────────────────────────

    it("POST /v1/characters — creates Alice with description", async () => {
        const { status, data } = await httpRequest<Character>(server.base, "POST", "/v1/characters", {
            name: "Alice",
            description: "A curious explorer",
        });
        assert.equal(status, 200);
        assert.equal(typeof data.id, "string");
        assert.ok(data.id.length > 0, "id must not be empty");
        assert.equal(data.name, "Alice");
        assert.equal(data.description, "A curious explorer");
        assert.equal(data.personaPrompt, "");
        assert.equal(data.greetingMessage, null);
        assert.equal(data.status, "active");
        assert.equal(typeof data.createdAt, "string");
        assert.equal(typeof data.updatedAt, "string");
        char1 = data;
    });

    it("POST /v1/characters — creates Bob without description", async () => {
        const { status, data } = await httpRequest<Character>(server.base, "POST", "/v1/characters", {
            name: "Bob",
        });
        assert.equal(status, 200);
        assert.equal(data.name, "Bob");
        assert.equal(data.description, "");
        char2 = data;
    });

    it("POST /v1/characters — rejects empty name with 400", async () => {
        const { status } = await httpRequest(server.base, "POST", "/v1/characters", { name: "" });
        assert.equal(status, 400);
    });

    // ── List after creates ────────────────────────────────────────────────────

    it("GET /v1/characters — lists both characters", async () => {
        const { status, data } = await httpRequest<ListCharactersResponse>(server.base, "GET", "/v1/characters");
        assert.equal(status, 200);
        assert.equal(data.characters.length, 2);
    });

    // ── Get one ───────────────────────────────────────────────────────────────

    it("GET /v1/characters/:id — returns Alice by id", async () => {
        const { status, data } = await httpRequest<Character>(server.base, "GET", `/v1/characters/${char1.id}`);
        assert.equal(status, 200);
        assert.equal(data.id, char1.id);
        assert.equal(data.name, "Alice");
    });

    it("GET /v1/characters/:id — returns 404 for unknown id", async () => {
        const { status } = await httpRequest(server.base, "GET", "/v1/characters/non-existent-id");
        assert.equal(status, 404);
    });

    // ── Update ────────────────────────────────────────────────────────────────

    it("PATCH /v1/characters/:id — updates Alice description", async () => {
        const { status, data } = await httpRequest<Character>(
            server.base, "PATCH", `/v1/characters/${char1.id}`,
            { description: "Updated description" }
        );
        assert.equal(status, 200);
        assert.equal(data.name, "Alice");
        assert.equal(data.description, "Updated description");
        assert.ok(data.updatedAt >= char1.updatedAt, "updatedAt must advance");
    });

    it("PATCH /v1/characters/:id — returns 404 for unknown id", async () => {
        const { status } = await httpRequest(server.base, "PATCH", "/v1/characters/non-existent-id", { name: "X" });
        assert.equal(status, 404);
    });

    // ── Delete ────────────────────────────────────────────────────────────────

    it("DELETE /v1/characters/:id — deletes Bob with 204", async () => {
        const { status } = await httpRequest(server.base, "DELETE", `/v1/characters/${char2.id}`);
        assert.equal(status, 204);
    });

    it("GET /v1/characters — only Alice remains after delete", async () => {
        const { status, data } = await httpRequest<ListCharactersResponse>(server.base, "GET", "/v1/characters");
        assert.equal(status, 200);
        assert.equal(data.characters.length, 1);
        assert.equal(data.characters[0].id, char1.id);
    });

    it("DELETE /v1/characters/:id — returns 404 for already-deleted id", async () => {
        const { status } = await httpRequest(server.base, "DELETE", `/v1/characters/${char2.id}`);
        assert.equal(status, 404);
    });
});

