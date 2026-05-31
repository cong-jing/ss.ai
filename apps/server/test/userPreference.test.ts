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
        apiKey: "",
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
        assert.equal(mistral.userApiKeySet, false);
        assert.equal(mistral.defaultApiKeySet, false);
        assert.equal(mistral.effectiveApiKeySource, "missing");
        // availableModels pre-filled because MOCK_MODELS.availableModels is non-empty
        assert.deepEqual(mistral.availableModels, ["mistral-large-latest", "mistral-small-latest"]);

        assert.ok(data.modelAssignments, "modelAssignments must be present");
        assert.equal(data.modelAssignments["chat.main"]?.effectiveAssignment, null);
        assert.equal(data.modelAssignments["memory.summarize"]?.effectiveAssignment, null);
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
        assert.equal(mistral.userApiKeySet, true);
        assert.equal(mistral.effectiveApiKeySource, "user");
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
        assert.equal(data.modelAssignments["chat.main"]!.userAssignment?.provider, "mistral");
        assert.equal(data.modelAssignments["chat.main"]!.userAssignment?.model, "mistral-large-latest");
    });

    it("GET /v1/user-preference — modelAssignments chat.main persists", async () => {
        const res = await app.agent.get("/v1/user-preference").expect(200);
        const data = res.body as GetUserPreferenceResponse;
        assert.ok(data.modelAssignments["chat.main"]);
        assert.equal(data.modelAssignments["chat.main"]!.effectiveAssignment?.provider, "mistral");
        assert.equal(data.modelAssignments["chat.main"]!.effectiveAssignment?.model, "mistral-large-latest");
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
        assert.equal(mistral.userApiKeySet, false);
        assert.equal(mistral.effectiveApiKeySource, "missing");
    });
});

describe("UserPreference API defaults", () => {
    let app: TestApp;

    before(() => {
        app = createTestApp({
            mistral: {
                provider: "mistral",
                apiUrl: "https://api.mistral.ai",
                apiKey: "shared-default-key",
                defaultModel: "mistral-large-latest",
                availableModels: ["mistral-small-latest", "mistral-large-latest"],
            },
        }, {
            defaultModelAssignments: {
                "chat.main": { provider: "mistral", model: "mistral-large-latest" },
            },
        });
    });

    after(() => {
        app.cleanup();
    });

    it("GET /v1/user-preference returns default key and assignment state", async () => {
        const res = await app.agent.get("/v1/user-preference").expect(200);
        const data = res.body as GetUserPreferenceResponse;

        const mistral = data.providers[0];
        assert.equal(mistral.userApiKeySet, false);
        assert.equal(mistral.defaultApiKeySet, true);
        assert.equal(mistral.effectiveApiKeySource, "default");
        assert.match(mistral.defaultApiKeyWarning ?? "", /default API key/i);

        assert.equal(data.modelAssignments["chat.main"]?.effectiveSource, "default");
        assert.equal(data.modelAssignments["chat.main"]?.effectiveAssignment?.provider, "mistral");
        assert.equal(data.modelAssignments["chat.main"]?.effectiveAssignment?.model, "mistral-large-latest");
    });

    it("POST /v1/user-preference/test-api-key performs remote validation with default api key", async () => {
        const res = await app.agent
            .post("/v1/user-preference/test-api-key")
            .send({ provider: "mistral" })
            .expect(200);

        assert.equal(res.body.ok, false);
        assert.equal(res.body.source, "default");
        assert.ok(typeof res.body.message === "string" && res.body.message.length > 0);
        assert.doesNotMatch(String(res.body.message ?? ""), /not remotely validated/i);
    });
});
