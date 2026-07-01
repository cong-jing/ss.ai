import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    buildMistralEmbeddingRequest,
    runMistralEmbed,
    transformMistralEmbeddingResponse,
    type MistralEmbeddingRequest,
    type MistralEmbeddingResponseLike,
    type MistralEmbeddingsSdkLike,
} from "../src/mistral/mistralEmbed.js";

function fakeSdkClient(handler: (request: MistralEmbeddingRequest) => Promise<MistralEmbeddingResponseLike> | MistralEmbeddingResponseLike): MistralEmbeddingsSdkLike {
    return {
        embeddings: {
            create: async (request) => handler(request),
        },
    };
}

describe("buildMistralEmbeddingRequest", () => {
    it("returns the exact wire shape Mistral expects", () => {
        const req = buildMistralEmbeddingRequest("mistral-embed", ["a", "b"]);
        assert.deepEqual(req, { model: "mistral-embed", inputs: ["a", "b"] });
    });

    it("rejects empty model", () => {
        assert.throws(() => buildMistralEmbeddingRequest("", ["a"]), /model is required/);
        assert.throws(() => buildMistralEmbeddingRequest("   ", ["a"]), /model is required/);
    });

    it("rejects empty inputs", () => {
        assert.throws(() => buildMistralEmbeddingRequest("m", []), /at least one text/);
        // @ts-expect-error intentional invalid input
        assert.throws(() => buildMistralEmbeddingRequest("m", null), /at least one text/);
    });
});

describe("transformMistralEmbeddingResponse", () => {
    it("maps data[].embedding to vectors and preserves order", () => {
        const result = transformMistralEmbeddingResponse(
            {
                model: "mistral-embed",
                data: [
                    { embedding: [0.1, 0.2], index: 0 },
                    { embedding: [0.3, 0.4], index: 1 },
                ],
                usage: { promptTokens: 4, totalTokens: 4 },
            },
            2,
            "mistral-embed",
        );
        assert.deepEqual(result.vectors, [[0.1, 0.2], [0.3, 0.4]]);
        assert.equal(result.model, "mistral-embed");
        assert.equal(result.usage?.promptTokens, 4);
        assert.equal(result.usage?.totalTokens, 4);
    });

    it("sorts by index when provider returns entries out of order", () => {
        const result = transformMistralEmbeddingResponse(
            {
                model: "mistral-embed",
                data: [
                    { embedding: [3], index: 2 },
                    { embedding: [1], index: 0 },
                    { embedding: [2], index: 1 },
                ],
            },
            3,
            "mistral-embed",
        );
        assert.deepEqual(result.vectors, [[1], [2], [3]]);
    });

    it("falls back to requested model when response.model is missing", () => {
        const result = transformMistralEmbeddingResponse(
            { data: [{ embedding: [1, 2] }] },
            1,
            "mistral-embed",
        );
        assert.equal(result.model, "mistral-embed");
    });

    it("throws when data length does not match expected count", () => {
        assert.throws(
            () => transformMistralEmbeddingResponse({ data: [{ embedding: [1] }] }, 2, "m"),
            /returned 1 embeddings but 2 were requested/,
        );
    });

    it("throws when embedding is not a number array", () => {
        assert.throws(
            () => transformMistralEmbeddingResponse({ data: [{ embedding: "not-a-vector" }] }, 1, "m"),
            /is not a finite number array/,
        );
        assert.throws(
            () => transformMistralEmbeddingResponse({ data: [{ embedding: [1, Number.NaN] }] }, 1, "m"),
            /is not a finite number array/,
        );
    });

    it("throws when data is not an array", () => {
        assert.throws(
            () => transformMistralEmbeddingResponse({ data: "nope" } as unknown as MistralEmbeddingResponseLike, 1, "m"),
            /response\.data is not an array/,
        );
    });

    it("throws when an entry's index is out of range", () => {
        // expectedCount matches data.length so the length check passes and
        // we exercise the index-range guard.
        assert.throws(
            () => transformMistralEmbeddingResponse(
                { data: [{ embedding: [1], index: 0 }, { embedding: [2], index: 5 }] },
                2,
                "m",
            ),
            /index "5" is out of range \[0, 2\)/,
        );
        assert.throws(
            () => transformMistralEmbeddingResponse(
                { data: [{ embedding: [1], index: -1 }] },
                1,
                "m",
            ),
            /index "-1" is out of range/,
        );
        assert.throws(
            () => transformMistralEmbeddingResponse(
                { data: [{ embedding: [1], index: 0 }, { embedding: [2], index: 1.5 }] },
                2,
                "m",
            ),
            /index "1\.5" is out of range/,
        );
    });

    it("throws when two entries share the same index", () => {
        assert.throws(
            () => transformMistralEmbeddingResponse(
                {
                    data: [
                        { embedding: [1], index: 0 },
                        { embedding: [2], index: 0 },
                    ],
                },
                2,
                "m",
            ),
            /index 0 is duplicated across entries/,
        );
    });

    it("returns usage with raw payload when typed token fields are missing", () => {
        const result = transformMistralEmbeddingResponse(
            { data: [{ embedding: [1] }], usage: { somethingElse: 1 } },
            1,
            "m",
        );
        assert.ok(result.usage);
        assert.deepEqual(result.usage.raw, { somethingElse: 1 });
    });
});

describe("runMistralEmbed", () => {
    it("calls embeddings.create with the built request and returns a transformed result", async () => {
        let captured: MistralEmbeddingRequest | undefined;
        const sdk = fakeSdkClient(async (req) => {
            captured = req;
            return {
                model: "mistral-embed",
                data: [{ embedding: [0.5, 0.5] }],
                usage: { promptTokens: 2, totalTokens: 2 },
            };
        });

        const result = await runMistralEmbed(sdk, "mistral-embed", ["hello"]);

        assert.deepEqual(captured, { model: "mistral-embed", inputs: ["hello"] });
        assert.deepEqual(result.vectors, [[0.5, 0.5]]);
        assert.equal(result.model, "mistral-embed");
        assert.equal(result.usage?.promptTokens, 2);
    });

    it("wraps SDK errors with a clear provider-side message prefix", async () => {
        const sdk = fakeSdkClient(async () => {
            throw new Error("network reset");
        });
        await assert.rejects(
            () => runMistralEmbed(sdk, "mistral-embed", ["hello"]),
            /Mistral embed: provider call failed: network reset/,
        );
    });

    it("propagates input-validation errors without the provider-call prefix", async () => {
        const sdk = fakeSdkClient(async () => ({ data: [] }));
        await assert.rejects(
            () => runMistralEmbed(sdk, "", ["hello"]),
            /model is required/,
        );
    });
});
