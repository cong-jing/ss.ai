/**
 * Integration tests for the UserPreference API.
 *
 * Uses supertest (in-process, no TCP) + node:test runner.
 * Run via the unified entry: npm test
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import type {
    GetUserPreferenceResponse,
    UpsertApiKeyResponse,
    DeleteApiKeyResponse,
    UpsertModelAssignmentResponse,
    ListModelsResponse,
} from "@ss-ai/contracts/apis/userPreference";
import type { RuntimeModelEntry } from "../src/util/config.js";
import { createTestApp, type TestApp } from "./helpers/testServer.js";

const MOCK_MODELS: Record<string, RuntimeModelEntry> = {
    mistral: {
        provider: "mistral",
        apiUrl: "https://api.mistral.ai",
        defaultModel: "mistral-large-latest",
        availableModels: ["mistral-small-latest", "mistral-large-latest"],
    },
};

describe("UserPreference API", () => {
    let app: TestApp;

    before(() => {
        app = createTestApp(MOCK_MODELS);
    });

    after(() => {
        app.cleanup();
    });

    // ── GET /v1/user-preference ─────────────────────────────────────────────────

    it("GET /v1/user-preference — returns provider list and empty modelAssignments", async () => {
        const res = await app.agent.get("/v1/user-preference").expect(200);
        const data = res.body as GetUserPreferenceResponse;

        assert.ok(Array.isArray(data.providers), "providers must be an array");
        assert.equal(data.providers.length, 1);
        const mistral = data.providers[0];
        assert.equal(mistral.provider, "mistral");
        assert.equal(mistral.apiKeySet, false);
        // availableModels pre-filled because MOCK_MODELS.availableModels is non-empty
        assert.deepEqual(mistral.availableModels, ["mistral-large-latest", "mistral-small-latest"]);

        assert.ok(data.modelAssignments, "modelAssignments must be present");
        assert.equal(data.modelAssignments["chat.main"], null);
        assert.equal(data.modelAssignments["memory.summarize"], null);
    });

    // ── POST /v1/user-preference/api-key ────────────────────────────────────────

    it("POST /v1/user-preference/api-key — sets key for mistral", async () => {
        const res = await app.agent
            .post("/v1/user-preference/api-key")
            .send({ provider: "mistral", apiKey: "test-key-abc" })
            .expect(200);
        const data = res.body as UpsertApiKeyResponse;
        assert.equal(data.provider, "mistral");
        assert.equal(data.apiKeySet, true);
    });

    it("GET /v1/user-preference — apiKeySet reflects set key", async () => {
        const res = await app.agent.get("/v1/user-preference").expect(200);
        const data = res.body as GetUserPreferenceResponse;
        const mistral = data.providers.find((p) => p.provider === "mistral");
        assert.ok(mistral);
        assert.equal(mistral.apiKeySet, true);
    });

    it("POST /v1/user-preference/api-key — rejects unknown provider with 400", async () => {
        await app.agent
            .post("/v1/user-preference/api-key")
            .send({ provider: "openai", apiKey: "key" })
            .expect(400);
    });

    it("POST /v1/user-preference/api-key — rejects empty apiKey with 400", async () => {
        await app.agent
            .post("/v1/user-preference/api-key")
            .send({ provider: "mistral", apiKey: "" })
            .expect(400);
    });

    // ── POST /v1/user-preference/model-assignment ───────────────────────────────

    it("POST /v1/user-preference/model-assignment — assigns chat model", async () => {
        const res = await app.agent
            .post("/v1/user-preference/model-assignment")
            .send({ modelCallPurpose: "chat.main", provider: "mistral", model: "mistral-large-latest" })
            .expect(200);
        const data = res.body as UpsertModelAssignmentResponse;
        assert.ok(data.modelAssignments["chat.main"]);
        assert.equal(data.modelAssignments["chat.main"]!.provider, "mistral");
        assert.equal(data.modelAssignments["chat.main"]!.model, "mistral-large-latest");
    });

    it("GET /v1/user-preference — modelAssignments chat.main persists", async () => {
        const res = await app.agent.get("/v1/user-preference").expect(200);
        const data = res.body as GetUserPreferenceResponse;
        assert.ok(data.modelAssignments["chat.main"]);
        assert.equal(data.modelAssignments["chat.main"]!.provider, "mistral");
        assert.equal(data.modelAssignments["chat.main"]!.model, "mistral-large-latest");
    });

    it("POST /v1/user-preference/model-assignment — rejects invalid model call purpose with 400", async () => {
        await app.agent
            .post("/v1/user-preference/model-assignment")
            .send({ modelCallPurpose: "unknown-function", provider: "mistral", model: "mistral-large-latest" })
            .expect(400);
    });

    // ── POST /v1/user-preference/list-models ────────────────────────────────────

    it("POST /v1/user-preference/list-models — returns pre-configured models", async () => {
        const res = await app.agent
            .post("/v1/user-preference/list-models")
            .send({ provider: "mistral" })
            .expect(200);
        const data = res.body as ListModelsResponse;
        assert.equal(data.provider, "mistral");
        assert.ok(Array.isArray(data.models));
        assert.ok(data.models.includes("mistral-large-latest"));
        assert.ok(data.models.includes("mistral-small-latest"));
    });

    it("POST /v1/user-preference/list-models — rejects unknown provider with 400", async () => {
        await app.agent
            .post("/v1/user-preference/list-models")
            .send({ provider: "openai" })
            .expect(400);
    });

    // ── POST /v1/user-preference/api-key/delete ────────────────────────────────

    it("POST /v1/user-preference/api-key/delete — removes key for mistral", async () => {
        const res = await app.agent
            .post("/v1/user-preference/api-key/delete")
            .send({ provider: "mistral" })
            .expect(200);
        const data = res.body as DeleteApiKeyResponse;
        assert.equal(data.provider, "mistral");
        assert.equal(data.apiKeySet, false);
    });

    it("GET /v1/user-preference — apiKeySet false after delete", async () => {
        const res = await app.agent.get("/v1/user-preference").expect(200);
        const data = res.body as GetUserPreferenceResponse;
        const mistral = data.providers.find((p) => p.provider === "mistral");
        assert.ok(mistral);
        assert.equal(mistral.apiKeySet, false);
    });
});
