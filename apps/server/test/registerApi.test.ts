import assert from "node:assert/strict";
import { describe, it } from "node:test";
import express from "express";
import supertest from "supertest";
import { ApiDefine } from "@ss-ai/contracts";
import { registerApi } from "../src/http/registerApi.js";

describe("registerApi fallback errors", () => {
    it("returns 500 for unexpected errors when no handleError is provided", async () => {
        const app = express();
        app.use(express.json());

        registerApi(
            app,
            new ApiDefine<{}, { ok: true }>("/boom", "POST"),
            {
                handleRequest: () => {
                    throw new Error("boom");
                },
            },
        );

        const response = await supertest(app)
            .post("/boom")
            .send({})
            .expect(500);

        assert.equal(response.body.message, "boom");
    });

    it("preserves explicit status codes exposed by thrown errors", async () => {
        const app = express();
        app.use(express.json());

        registerApi(
            app,
            new ApiDefine<{}, { ok: true }>("/missing", "POST"),
            {
                handleRequest: () => {
                    const error = new Error("missing");
                    (error as Error & { statusCode: number }).statusCode = 404;
                    throw error;
                },
            },
        );

        const response = await supertest(app)
            .post("/missing")
            .send({})
            .expect(404);

        assert.equal(response.body.message, "missing");
    });
});
