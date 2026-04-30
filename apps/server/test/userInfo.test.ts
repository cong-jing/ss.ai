/**
 * Integration tests for the UserInfo API.
 *
 * Uses supertest (in-process, no TCP) + node:test runner.
 * Run via the unified entry: npm test
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import type { GetUserInfoResponse, UpsertUserInfoResponse } from "@ss-ai/contracts/apis/userInfo";
import { createTestApp, type TestApp } from "./helpers/testServer.js";

describe("UserInfo API", () => {
    let app: TestApp;

    before(() => {
        app = createTestApp();
    });

    after(() => {
        app.cleanup();
    });

    // ── GET /v1/user-info ─────────────────────────────────────────────────────

    it("GET /v1/user-info — returns empty defaults initially", async () => {
        const res = await app.agent.get("/v1/user-info").expect(200);
        const data = res.body as GetUserInfoResponse;
        assert.equal(data.name, "");
        assert.equal(data.bio, "");
        assert.equal(data.preferredAddress, null);
    });

    // ── POST /v1/user-info ────────────────────────────────────────────────────

    it("POST /v1/user-info — saves name and bio", async () => {
        const res = await app.agent
            .post("/v1/user-info")
            .send({ name: "Alice", bio: "Curious explorer" })
            .expect(200);
        const data = res.body as UpsertUserInfoResponse;
        assert.equal(data.name, "Alice");
        assert.equal(data.bio, "Curious explorer");
        assert.equal(data.preferredAddress, null);
    });

    it("GET /v1/user-info — persists saved values", async () => {
        const res = await app.agent.get("/v1/user-info").expect(200);
        const data = res.body as GetUserInfoResponse;
        assert.equal(data.name, "Alice");
        assert.equal(data.bio, "Curious explorer");
        assert.equal(data.preferredAddress, null);
    });

    it("POST /v1/user-info — saves preferredAddress", async () => {
        const res = await app.agent
            .post("/v1/user-info")
            .send({ name: "Alice", bio: "Curious explorer", preferredAddress: "Alice-san" })
            .expect(200);
        const data = res.body as UpsertUserInfoResponse;
        assert.equal(data.preferredAddress, "Alice-san");
    });

    it("GET /v1/user-info — preferredAddress persists", async () => {
        const res = await app.agent.get("/v1/user-info").expect(200);
        const data = res.body as GetUserInfoResponse;
        assert.equal(data.preferredAddress, "Alice-san");
    });

    it("POST /v1/user-info — clears preferredAddress when empty string sent", async () => {
        const res = await app.agent
            .post("/v1/user-info")
            .send({ name: "Alice", bio: "Curious explorer", preferredAddress: "" })
            .expect(200);
        const data = res.body as UpsertUserInfoResponse;
        assert.equal(data.preferredAddress, null);
    });

    it("POST /v1/user-info — updates name without losing other fields", async () => {
        // Set a full profile first
        await app.agent
            .post("/v1/user-info")
            .send({ name: "Alice Updated", bio: "New bio", preferredAddress: "Ali" })
            .expect(200);

        const res = await app.agent.get("/v1/user-info").expect(200);
        const data = res.body as GetUserInfoResponse;
        assert.equal(data.name, "Alice Updated");
        assert.equal(data.bio, "New bio");
        assert.equal(data.preferredAddress, "Ali");
    });
});
