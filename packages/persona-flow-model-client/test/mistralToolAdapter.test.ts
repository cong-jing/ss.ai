import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { submitTurnEventsTool, type ModelGenerationInput } from "@ss-ai/persona-flow";
import { toMistralToolRequest } from "../src/mistral/mistralToolAdapter.js";

describe("mistralToolAdapter", () => {
    it("converts submit_turn_events to a Mistral function tool schema", () => {
        const input: ModelGenerationInput = {
            provider: "mistral.ai",
            model: "test-model",
            encryptedApiKey: "test-key",
            messages: [{ role: "user", content: "hello" }],
            tools: [submitTurnEventsTool],
            toolChoice: {
                type: "function",
                functionName: submitTurnEventsTool.name,
            },
        };

        const request = toMistralToolRequest(input);
        assert.equal(request.tools?.length, 1);
        assert.deepEqual(request.toolChoice, {
            type: "function",
            function: { name: "submit_turn_events" },
        });

        const tool = request.tools?.[0];
        assert.equal(tool?.type, "function");
        assert.equal(tool?.function.name, "submit_turn_events");

        const parameters = tool?.function.parameters as {
            type?: unknown;
            required?: unknown;
            properties?: {
                events?: {
                    type?: unknown;
                    items?: {
                        anyOf?: unknown;
                        oneOf?: unknown;
                    };
                };
            };
        };
        const eventBranches = parameters.properties?.events?.items?.anyOf
            ?? parameters.properties?.events?.items?.oneOf;

        assert.equal(parameters.type, "object");
        assert.deepEqual(parameters.required, ["events"]);
        assert.equal(parameters.properties?.events?.type, "array");
        assert.ok(Array.isArray(eventBranches));
        assert.ok(eventBranches.length >= 4);
    });
});