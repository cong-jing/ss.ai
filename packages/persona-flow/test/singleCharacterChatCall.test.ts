import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Character, ConversationActor, Message, PromptContext, UserProfile } from "../src/index.js";
import { singleCharacterChatCall } from "../src/index.js";
import type { ModelRuntime } from "../src/modelCall/modelRuntime.js";

function fixedIso(offset = 0): string {
    return new Date(Date.UTC(2026, 0, 1, 0, 0, offset)).toISOString();
}

function createPromptContext(input: { language?: Character["language"] } = {}): PromptContext {
    const character: Character = {
        id: "c1",
        userId: "u1",
        name: "Shishi",
        displayName: "诗诗",
        personaPrompt: "friendly",
        language: input.language,
        modelConfig: {},
        generationConfig: {},
        memoryConfig: {},
        status: "active",
        createdAt: fixedIso(0),
        updatedAt: fixedIso(1),
    };
    const userProfile: UserProfile = {
        userId: "u1",
        name: "User",
        bio: "",
        metadata: {},
        createdAt: fixedIso(0),
        updatedAt: fixedIso(0),
    };
    const selfActor: ConversationActor = {
        id: "actor-self",
        conversationId: "conv1",
        role: "self",
        sourceType: "ai_character",
        displayName: "诗诗",
        userProfileId: null,
        characterId: "c1",
        profileSnapshotJson: null,
        leftAt: null,
        createdAt: fixedIso(0),
        updatedAt: fixedIso(0),
    };
    const currentUserMessage: Message = {
        id: "m-user",
        conversationId: "conv1",
        senderActorId: "actor-user",
        kind: "user_text",
        displayText: "hello",
        createdAt: fixedIso(2),
    };

    return {
        character,
        userProfile,
        actors: [selfActor],
        actorMap: new Map([[selfActor.id, selfActor]]),
        recentMessages: [],
        currentUserMessage,
    };
}

describe("singleCharacterChatCall", () => {
    it("selects the system prompt template from the character language", async () => {
        const runtime = {} as unknown as ModelRuntime;

        const englishResult = await singleCharacterChatCall.run({
            runtime,
            userId: "u1",
            characterId: "c1",
            promptContext: createPromptContext({ language: "en-US" }),
            dryRun: true,
        });
        assert.match(englishResult.llmRequestSnapshot?.messages[0]?.content ?? "", /You are a roleplay turn controller/);

        const japaneseResult = await singleCharacterChatCall.run({
            runtime,
            userId: "u1",
            characterId: "c1",
            promptContext: createPromptContext({ language: "ja-JP" }),
            dryRun: true,
        });
        assert.match(japaneseResult.llmRequestSnapshot?.messages[0]?.content ?? "", /あなたはロールプレイのターン制御役です/);
    });

    it("falls back to the Chinese system prompt when the character language is missing", async () => {
        const result = await singleCharacterChatCall.run({
            runtime: {} as unknown as ModelRuntime,
            userId: "u1",
            characterId: "c1",
            promptContext: createPromptContext(),
            dryRun: true,
        });

        assert.match(result.llmRequestSnapshot?.messages[0]?.content ?? "", /你是一个角色扮演回合控制器/);
    });

    it("dry-run request mentions memoryWriteCandidates and does not register the legacy memory tool", async () => {
        // Guards against accidentally reintroducing the submit_memory_candidates
        // tool design. memoryWriteCandidates must travel inside the structured
        // output JSON, so the rendered prompt must explain that field and the
        // request must not register any tools or set a tool choice.
        const runtime = {} as unknown as ModelRuntime;

        for (const language of ["zh-CN", "en-US", "ja-JP"] as const) {
            const result = await singleCharacterChatCall.run({
                runtime,
                userId: "u1",
                characterId: "c1",
                promptContext: createPromptContext({ language }),
                dryRun: true,
            });

            const systemContent = result.llmRequestSnapshot?.messages[0]?.content ?? "";
            assert.match(
                systemContent,
                /memoryWriteCandidates/,
                `expected system prompt for ${language} to mention memoryWriteCandidates`,
            );
            assert.doesNotMatch(
                systemContent,
                /submit_memory_candidates/,
                `system prompt for ${language} must not reference the removed submit_memory_candidates tool`,
            );

            assert.equal(
                result.llmRequestSnapshot?.tools,
                undefined,
                `request for ${language} must not register any tools`,
            );
            assert.equal(
                result.llmRequestSnapshot?.toolChoice,
                undefined,
                `request for ${language} must not set toolChoice`,
            );

            // The structured-output schema is still required: memoryWriteCandidates
            // travels inside `submit_turn_events`.
            assert.equal(
                result.llmRequestSnapshot?.structuredOutputSchema?.jsonSchema?.name,
                "submit_turn_events",
            );
        }
    });

    it("folds submit_turn_events into parsedOutput without duplicating parsedToolCalls", async () => {
        const runtime = {
            chat: async () => ({
                output: "",
                model: "m1",
                requestId: "req1",
                apiKeySource: "default" as const,
                structuredOutput: {
                    events: [
                        { type: "replyText" as const, characterId: "c1", text: "诗诗: hello back" },
                        { type: "expression" as const, characterId: "c1", expression: "happy" },
                    ],
                },
                toolCalls: [],
            }),
        } as unknown as ModelRuntime;

        const result = await singleCharacterChatCall.run({
            runtime,
            userId: "u1",
            characterId: "c1",
            promptContext: createPromptContext(),
        });

        assert.equal(result.parsedOutput?.displayText, "hello back");
        assert.equal(result.parsedOutput?.events.length, 2);
        assert.deepEqual(result.parsedOutput?.memoryWriteCandidates, []);
        assert.equal(result.parsedToolCalls, undefined);
    });

    it("does not register any tools and parses memoryWriteCandidates from structured output", async () => {
        let seenTools: unknown;
        let seenToolChoice: unknown;
        const runtime = {
            chat: async (request: { tools?: unknown; toolChoice?: unknown }) => {
                seenTools = request.tools;
                seenToolChoice = request.toolChoice;
                return {
                    output: "",
                    model: "m1",
                    requestId: "req1",
                    apiKeySource: "default" as const,
                    structuredOutput: {
                        events: [
                            { type: "replyText" as const, characterId: "c1", text: "hello" },
                        ],
                        memoryWriteCandidates: [
                            {
                                text: "User lives in Tokyo.",
                                scope: "user",
                                type: "fact",
                            },
                        ],
                    },
                    toolCalls: [],
                };
            },
        } as unknown as ModelRuntime;

        const result = await singleCharacterChatCall.run({
            runtime,
            userId: "u1",
            characterId: "c1",
            promptContext: createPromptContext(),
        });

        assert.equal(seenTools, undefined);
        assert.equal(seenToolChoice, undefined);
        assert.equal(result.parsedOutput?.memoryWriteCandidates.length, 1);
        assert.equal(result.parsedOutput?.memoryWriteCandidates[0]?.text, "User lives in Tokyo.");
        assert.equal(result.parsedOutput?.memoryWriteCandidates[0]?.scope, "user");
        assert.equal(result.parsedOutput?.memoryWriteCandidates[0]?.type, "fact");
    });

    it("returns empty memoryWriteCandidates when the structured output omits the field", async () => {
        const runtime = {
            chat: async () => ({
                output: "",
                model: "m1",
                requestId: "req1",
                apiKeySource: "default" as const,
                structuredOutput: {
                    events: [
                        { type: "replyText" as const, characterId: "c1", text: "hi" },
                    ],
                },
                toolCalls: [],
            }),
        } as unknown as ModelRuntime;

        const result = await singleCharacterChatCall.run({
            runtime,
            userId: "u1",
            characterId: "c1",
            promptContext: createPromptContext(),
        });

        assert.deepEqual(result.parsedOutput?.memoryWriteCandidates, []);
    });

    it("drops invalid memoryWriteCandidates entries without failing the chat turn", async () => {
        // memoryWriteCandidates is a fail-soft side channel: invalid entries
        // (e.g. empty `text`) must NOT block the visible chat result. Valid
        // siblings should still survive and be returned.
        const runtime = {
            chat: async () => ({
                output: "",
                model: "m1",
                requestId: "req1",
                apiKeySource: "default" as const,
                structuredOutput: {
                    events: [
                        { type: "replyText" as const, characterId: "c1", text: "hi" },
                    ],
                    memoryWriteCandidates: [
                        { text: "", scope: "user", type: "fact" },
                        { text: "User lives in Tokyo.", scope: "user", type: "fact" },
                    ],
                },
                toolCalls: [],
            }),
        } as unknown as ModelRuntime;

        const result = await singleCharacterChatCall.run({
            runtime,
            userId: "u1",
            characterId: "c1",
            promptContext: createPromptContext(),
        });

        assert.equal(result.parsedOutput?.displayText, "hi");
        assert.equal(result.parsedOutput?.memoryWriteCandidates.length, 1);
        assert.equal(result.parsedOutput?.memoryWriteCandidates[0]?.text, "User lives in Tokyo.");
    });

    it("caps memoryWriteCandidates at 5 entries (lenient parser bypasses the strict schema cap)", async () => {
        // The strict SubmitTurnEventsArgsSchema caps memoryWriteCandidates at
        // 5, but in batch 1 we bypass that strict path and validate
        // candidates leniently with `safeParse` so an invalid sibling never
        // blocks the chat. The lenient path must enforce the same hard cap
        // so a misbehaving model cannot flood the log.
        const candidates = Array.from({ length: 8 }, (_, idx) => ({
            text: `fact-${idx}`,
            scope: "user" as const,
            type: "fact" as const,
        }));
        const runtime = {
            chat: async () => ({
                output: "",
                model: "m1",
                requestId: "req1",
                apiKeySource: "default" as const,
                structuredOutput: {
                    events: [
                        { type: "replyText" as const, characterId: "c1", text: "hi" },
                    ],
                    memoryWriteCandidates: candidates,
                },
                toolCalls: [],
            }),
        } as unknown as ModelRuntime;

        const result = await singleCharacterChatCall.run({
            runtime,
            userId: "u1",
            characterId: "c1",
            promptContext: createPromptContext(),
        });

        assert.equal(result.parsedOutput?.memoryWriteCandidates.length, 5);
        // Preserves arrival order: the first 5 valid candidates win.
        assert.deepEqual(
            result.parsedOutput?.memoryWriteCandidates.map(c => c.text),
            ["fact-0", "fact-1", "fact-2", "fact-3", "fact-4"],
        );
    });

    it("parses memoryWriteCandidates when structuredOutput arrives as a JSON string", async () => {
        // Provider adapters normally pre-parse structured output into an
        // object, but `splitStructuredOutput` defensively tolerates a raw
        // JSON string so a misbehaving adapter does not crash the chat
        // path. Lock this behavior with a direct test because no provider
        // currently exercises this branch.
        const runtime = {
            chat: async () => ({
                output: "",
                model: "m1",
                requestId: "req1",
                apiKeySource: "default" as const,
                structuredOutput: JSON.stringify({
                    events: [
                        { type: "replyText", characterId: "c1", text: "hi" },
                    ],
                    memoryWriteCandidates: [
                        { text: "User lives in Tokyo.", scope: "user", type: "fact" },
                    ],
                }),
                toolCalls: [],
            }),
        } as unknown as ModelRuntime;

        const result = await singleCharacterChatCall.run({
            runtime,
            userId: "u1",
            characterId: "c1",
            promptContext: createPromptContext(),
        });

        assert.equal(result.parsedOutput?.displayText, "hi");
        assert.equal(result.parsedOutput?.memoryWriteCandidates.length, 1);
        assert.equal(result.parsedOutput?.memoryWriteCandidates[0]?.text, "User lives in Tokyo.");
        assert.equal(result.parsedOutput?.memoryWriteCandidates[0]?.scope, "user");
    });
});