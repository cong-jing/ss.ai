/**
 * Integration tests for the UserProfile API.
 *
 * Uses supertest (in-process, no TCP) + node:test runner.
 * Run via the unified entry: npm test
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import type { GetUserProfileResponse, UpsertUserProfileResponse } from "@ss-ai/contracts/apis/userProfile";
import { createTestApp, type TestApp } from "./helpers/testServer.js";

describe("UserProfile API", () => {
    let app: TestApp;

    before(() => {
        app = createTestApp();
    });

    after(() => {
        app.cleanup();
    });

    // ── GET /v1/user-profile ───────────────────────────────────────────────────

    it("GET /v1/user-profile — returns empty defaults initially", async () => {
        const res = await app.agent.get("/v1/user-profile").expect(200);
        const data = res.body as GetUserProfileResponse;
        assert.equal(data.name, "");
        assert.equal(data.bio, "");
        assert.equal(data.preferredAddress, null);
    });

    // ── POST /v1/user-profile ───────────────────────────────────────────────────

    it("POST /v1/user-profile — saves name and bio", async () => {
        const res = await app.agent
            .post("/v1/user-profile")
            .send({ name: "Alice", bio: "Curious explorer" })
            .expect(200);
        const data = res.body as UpsertUserProfileResponse;
        assert.equal(data.name, "Alice");
        assert.equal(data.bio, "Curious explorer");
        assert.equal(data.preferredAddress, null);
    });

    it("GET /v1/user-profile — persists saved values", async () => {
        const res = await app.agent.get("/v1/user-profile").expect(200);
        const data = res.body as GetUserProfileResponse;
        assert.equal(data.name, "Alice");
        assert.equal(data.bio, "Curious explorer");
        assert.equal(data.preferredAddress, null);
    });

    it("POST /v1/user-profile — saves preferredAddress", async () => {
        const res = await app.agent
            .post("/v1/user-profile")
            .send({ name: "Alice", bio: "Curious explorer", preferredAddress: "Alice-san" })
            .expect(200);
        const data = res.body as UpsertUserProfileResponse;
        assert.equal(data.preferredAddress, "Alice-san");
    });

    it("GET /v1/user-profile — preferredAddress persists", async () => {
        const res = await app.agent.get("/v1/user-profile").expect(200);
        const data = res.body as GetUserProfileResponse;
        assert.equal(data.preferredAddress, "Alice-san");
    });

    it("POST /v1/user-profile — clears preferredAddress when empty string sent", async () => {
        const res = await app.agent
            .post("/v1/user-profile")
            .send({ name: "Alice", bio: "Curious explorer", preferredAddress: "" })
            .expect(200);
        const data = res.body as UpsertUserProfileResponse;
        assert.equal(data.preferredAddress, null);
    });

    it("POST /v1/user-profile — updates name without losing other fields", async () => {
        // Set a full profile first
        await app.agent
            .post("/v1/user-profile")
            .send({ name: "Alice Updated", bio: "New bio", preferredAddress: "Ali" })
            .expect(200);

        const res = await app.agent.get("/v1/user-profile").expect(200);
        const data = res.body as GetUserProfileResponse;
        assert.equal(data.name, "Alice Updated");
        assert.equal(data.bio, "New bio");
        assert.equal(data.preferredAddress, "Ali");
    });
});
