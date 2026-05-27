import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import type { Character, ListCharactersResponse } from "@ss-ai/contracts";
import { createTestApp, type TestApp } from "./helpers/testServer.js";

describe("Auth API", () => {
    let app: TestApp;

    before(() => {
        app = createTestApp({}, {
            auth: {
                mode: "local-password",
                defaultUserId: "default",
                allowRegistration: true,
                sessionDays: 30,
                cookieName: "ss_ai_session",
            },
        });
    });

    after(() => {
        app.cleanup();
    });

    it("blocks business endpoints before login", async () => {
        await app.agent.get("/v1/characters").expect(401);
    });

    it("supports registration and session-based access", async () => {
        const registerRes = await app.agent
            .post("/v1/auth/register")
            .send({ username: "alice", password: "password123", displayName: "Alice" })
            .expect(200);

        const cookie = registerRes.headers["set-cookie"]?.[0];
        assert.ok(cookie, "register should issue a session cookie");

        const createRes = await app.agent
            .post("/v1/characters")
            .set("Cookie", cookie)
            .send({ name: "Alice Character" })
            .expect(200);
        const created = createRes.body as Character;
        assert.equal(created.name, "Alice Character");

        const listRes = await app.agent
            .get("/v1/characters")
            .set("Cookie", cookie)
            .expect(200);
        const list = listRes.body as ListCharactersResponse;
        assert.equal(list.characters.length, 1);
    });

    it("isolates data between users", async () => {
        const registerBobRes = await app.agent
            .post("/v1/auth/register")
            .send({ username: "bob", password: "password123", displayName: "Bob" })
            .expect(200);
        const bobCookie = registerBobRes.headers["set-cookie"]?.[0];
        assert.ok(bobCookie, "register should issue a session cookie");

        const bobList = await app.agent
            .get("/v1/characters")
            .set("Cookie", bobCookie)
            .expect(200);

        assert.equal((bobList.body as ListCharactersResponse).characters.length, 0);
    });

    it("invalidates session on logout", async () => {
        const loginRes = await app.agent
            .post("/v1/auth/login")
            .send({ username: "alice", password: "password123" })
            .expect(200);
        const cookie = loginRes.headers["set-cookie"]?.[0];
        assert.ok(cookie, "login should issue a session cookie");

        await app.agent
            .post("/v1/auth/logout")
            .set("Cookie", cookie)
            .expect(204);

        await app.agent
            .get("/v1/characters")
            .set("Cookie", cookie)
            .expect(401);
    });
});
