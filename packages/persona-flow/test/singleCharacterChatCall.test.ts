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
        assert.equal(result.parsedToolCalls, undefined);
    });
});