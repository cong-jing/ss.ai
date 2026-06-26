import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    accumulateToolCallDelta,
    extractStructuredOutput,
    extractText,
    isMistralMessageContentEmpty,
    normalizeStreamToolCallDeltas,
    normalizeToolCall,
    normalizeToolCallArguments,
    type ToolCallAccumulator,
} from "../src/mistral/messageTransforms.js";

describe("mistral message transforms", () => {
    it("treats missing or blank message content as empty", () => {
        assert.equal(isMistralMessageContentEmpty({}), true);
        assert.equal(isMistralMessageContentEmpty({ content: null }), true);
        assert.equal(isMistralMessageContentEmpty({ content: "   " }), true);
        assert.equal(isMistralMessageContentEmpty({ content: [] }), true);
        assert.equal(isMistralMessageContentEmpty({ content: [{ type: "text", text: "" }] }), true);
    });

    it("does not treat unknown non-empty content parts as empty", () => {
        const message = { content: [{ type: "unexpected", payload: "value" }] };
        const response = { choices: [{ message }] };

        assert.equal(isMistralMessageContentEmpty(message), false);
        assert.throws(() => extractText(response), /did not contain text content/i);
    });

    it("extracts text from string and array content", () => {
        assert.equal(extractText({ choices: [{ message: { content: "hello" } }] }), "hello");
        assert.equal(extractText({ choices: [{ message: { content: [{ type: "text", text: "hello" }, " world"] } }] }), "hello world");
    });

    it("normalizes stream tool call deltas from camelCase and snake_case fields", () => {
        const camelCaseDeltas = normalizeStreamToolCallDeltas({
            toolCalls: [
                {
                    index: 0,
                    id: "call-0",
                    type: "function",
                    function: {
                        name: "submit_turn_events",
                        arguments: "{\"events\":[",
                    },
                },
            ],
        });

        assert.deepEqual(camelCaseDeltas, [
            {
                index: 0,
                id: "call-0",
                type: "function",
                functionNameDelta: "submit_turn_events",
                argumentsDelta: "{\"events\":[",
                raw: {
                    index: 0,
                    id: "call-0",
                    type: "function",
                    function: {
                        name: "submit_turn_events",
                        arguments: "{\"events\":[",
                    },
                },
            },
        ]);

        const snakeCaseDeltas = normalizeStreamToolCallDeltas({
            tool_calls: [
                {
                    index: 1,
                    function: {
                        name_delta: "submit_",
                        arguments_delta: "{\"type\":\"replyText\"",
                    },
                },
            ],
        });

        assert.equal(snakeCaseDeltas.length, 1);
        assert.equal(snakeCaseDeltas[0].index, 1);
        assert.equal(snakeCaseDeltas[0].functionNameDelta, "submit_");
        assert.equal(snakeCaseDeltas[0].argumentsDelta, "{\"type\":\"replyText\"");
    });

    it("accumulates fragmented stream tool calls by index", () => {
        const accumulators = new Map<number, ToolCallAccumulator>();
        const deltas = [
            ...normalizeStreamToolCallDeltas({
                toolCalls: [
                    {
                        index: 0,
                        id: "call-0",
                        type: "function",
                        function: {
                            name: "submit_turn_events",
                            arguments: "{\"events\":[",
                        },
                    },
                    {
                        index: 1,
                        id: "call-1",
                        type: "function",
                        function: {
                            name: "other_tool",
                            arguments: "{\"value\":",
                        },
                    },
                ],
            }),
            ...normalizeStreamToolCallDeltas({
                tool_calls: [
                    {
                        index: 0,
                        function: {
                            arguments_delta: "{\"type\":\"replyText\",\"text\":\"hello\"}]}",
                        },
                    },
                    {
                        index: 1,
                        function: {
                            arguments_delta: "\"ok\"}",
                        },
                    },
                ],
            }),
        ];

        for (const delta of deltas) {
            accumulateToolCallDelta(accumulators, delta);
        }

        assert.equal(accumulators.size, 2);
        assert.deepEqual(accumulators.get(0), {
            index: 0,
            id: "call-0",
            type: "function",
            functionName: "submit_turn_events",
            argumentsBuffer: "{\"events\":[{\"type\":\"replyText\",\"text\":\"hello\"}]}",
        });
        assert.deepEqual(accumulators.get(1), {
            index: 1,
            id: "call-1",
            type: "function",
            functionName: "other_tool",
            argumentsBuffer: "{\"value\":\"ok\"}",
        });
    });

    it("normalizeToolCallArguments parses JSON string arguments into objects", () => {
        const result = normalizeToolCallArguments("{\"candidates\":[]}");
        assert.deepEqual(result.parsed, { candidates: [] });
        assert.equal(result.raw, "{\"candidates\":[]}");
    });

    it("normalizeToolCallArguments passes through already-structured arguments", () => {
        const result = normalizeToolCallArguments({ candidates: [{ text: "x" }] });
        assert.deepEqual(result.parsed, { candidates: [{ text: "x" }] });
        assert.equal(result.raw, undefined);
    });

    it("normalizeToolCallArguments returns empty when arguments are missing", () => {
        assert.deepEqual(normalizeToolCallArguments(undefined), {});
        assert.deepEqual(normalizeToolCallArguments(null), {});
    });

    it("normalizeToolCallArguments keeps raw text when JSON parsing fails", () => {
        const result = normalizeToolCallArguments("{not json");
        assert.equal(result.parsed, undefined);
        assert.equal(result.raw, "{not json");
    });

    it("normalizeToolCall parses non-stream tool-call arguments from a JSON string", () => {
        const toolCall = normalizeToolCall({
            id: "call-7",
            type: "function",
            index: 0,
            function: {
                name: "submit_memory_candidates",
                arguments: "{\"candidates\":[{\"text\":\"User likes tea.\",\"scope\":\"user\",\"type\":\"preference\"}]}",
            },
        });

        assert.equal(toolCall.functionName, "submit_memory_candidates");
        assert.deepEqual(toolCall.arguments, {
            candidates: [
                { text: "User likes tea.", scope: "user", type: "preference" },
            ],
        });
        assert.equal(
            toolCall.argumentsRaw,
            "{\"candidates\":[{\"text\":\"User likes tea.\",\"scope\":\"user\",\"type\":\"preference\"}]}",
        );
    });

    it("normalizeToolCall passes through structured arguments without setting argumentsRaw", () => {
        const toolCall = normalizeToolCall({
            id: "call-8",
            type: "function",
            function: {
                name: "submit_memory_candidates",
                arguments: { candidates: [] },
            },
        });

        assert.deepEqual(toolCall.arguments, { candidates: [] });
        assert.equal(toolCall.argumentsRaw, undefined);
    });

    it("extractStructuredOutput returns parsed when message.parsed is present", () => {
        const response = {
            choices: [{ message: { parsed: { events: [] }, content: "" } }],
        };
        assert.deepEqual(extractStructuredOutput(response), { events: [] });
    });

    it("extractStructuredOutput parses JSON string content when parsed is absent", () => {
        const response = {
            choices: [{ message: { content: '{"events":[{"kind":"replyText"}]}' } }],
        };
        assert.deepEqual(extractStructuredOutput(response), {
            events: [{ kind: "replyText" }],
        });
    });

    it("extractStructuredOutput returns undefined when message has only tool calls (no content)", () => {
        // Common shape: provider chose to call a tool instead of producing
        // content, so `content` is empty/missing and `parsed` is absent.
        const response = {
            choices: [
                {
                    message: {
                        content: "",
                        tool_calls: [
                            {
                                id: "call-1",
                                type: "function",
                                function: { name: "submit_memory_candidates", arguments: "{}" },
                            },
                        ],
                    },
                },
            ],
        };
        assert.equal(extractStructuredOutput(response), undefined);
    });

    it("extractStructuredOutput returns undefined when message is completely empty", () => {
        const response = { choices: [{ message: {} }] };
        assert.equal(extractStructuredOutput(response), undefined);
    });
});
