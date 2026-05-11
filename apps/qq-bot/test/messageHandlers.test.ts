import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { configureConversationStore, getPrivateActorBinding, getGroupMemberActorBinding } from "../src/conversationStore.js";
import { configureLogger } from "../src/logger.js";
import { handlePrivateMessage } from "../src/handlers/privateMessageHandler.js";
import { handleGroupMessage } from "../src/handlers/groupMessageHandler.js";
import type { MessageHandlerContext } from "../src/handlers/messageHandlerContext.js";

const tempDirs: string[] = [];

function setupTempRuntime(): void {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "qq-bot-handler-test-"));
    tempDirs.push(dir);
    configureConversationStore(path.join(dir, "conversation-map.json"));
    configureLogger(path.join(dir, "qq-bot.log"));
}

afterEach(() => {
    while (tempDirs.length > 0) {
        const dir = tempDirs.pop();
        if (dir) fs.rmSync(dir, { recursive: true, force: true });
    }
});

describe("message handlers", () => {
    it("private handler creates actor once and reuses binding", async () => {
        setupTempRuntime();

        const sendActions: Array<{ action: string; params: Record<string, unknown> }> = [];
        let createActorCalls = 0;
        const chatCalls: Array<{ conversationId: string; prompt: string; speakerActorId?: string }> = [];

        const context: MessageHandlerContext = {
            getCharacterId: () => "char-1",
            getBotSelfId: () => 999,
            resolveConversationId: async () => "conv-private-1",
            createLocalActor: async () => {
                createActorCalls += 1;
                return "actor-private-1";
            },
            chat: async (conversationId, prompt, speakerActorId) => {
                chatCalls.push({ conversationId, prompt, speakerActorId });
                return "reply";
            },
            sendAction: (action, params) => {
                sendActions.push({ action, params });
            },
        };

        const event = {
            user_id: 10001,
            raw_message: "hello",
            sender: { nickname: "Alice" },
        };

        await handlePrivateMessage(event, context);
        await handlePrivateMessage(event, context);

        assert.equal(createActorCalls, 1);
        assert.equal(sendActions.length, 2);
        assert.equal(sendActions[0]?.action, "send_private_msg");
        assert.equal(chatCalls.length, 2);
        assert.equal(chatCalls[0]?.speakerActorId, "actor-private-1");
        assert.equal(chatCalls[1]?.speakerActorId, "actor-private-1");
        assert.equal(getPrivateActorBinding(10001)?.conversationId, "conv-private-1");
    });

    it("group handler only processes @self messages", async () => {
        setupTempRuntime();

        const sendActions: Array<{ action: string; params: Record<string, unknown> }> = [];
        let createActorCalls = 0;
        const chatCalls: Array<{ prompt: string; speakerActorId?: string }> = [];

        const context: MessageHandlerContext = {
            getCharacterId: () => "char-1",
            getBotSelfId: () => 999,
            resolveConversationId: async () => "conv-group-1",
            createLocalActor: async () => {
                createActorCalls += 1;
                return "actor-group-1";
            },
            chat: async (_conversationId, prompt, speakerActorId) => {
                chatCalls.push({ prompt, speakerActorId });
                return "group-reply";
            },
            sendAction: (action, params) => {
                sendActions.push({ action, params });
            },
        };

        await handleGroupMessage(
            {
                group_id: 20001,
                user_id: 10001,
                raw_message: "not mention",
                message: [{ type: "text", data: { text: "not mention" } }],
            },
            context,
        );

        assert.equal(createActorCalls, 0);
        assert.equal(chatCalls.length, 0);
        assert.equal(sendActions.length, 0);

        await handleGroupMessage(
            {
                group_id: 20001,
                user_id: 10001,
                raw_message: "[CQ:at,qq=999]   hello group ",
                message: [
                    { type: "at", data: { qq: "999" } },
                    { type: "text", data: { text: "hello group" } },
                ],
                sender: { card: "Bob" },
            },
            context,
        );

        assert.equal(createActorCalls, 1);
        assert.equal(chatCalls.length, 1);
        assert.equal(chatCalls[0]?.prompt, "hello group");
        assert.equal(chatCalls[0]?.speakerActorId, "actor-group-1");
        assert.equal(sendActions.length, 1);
        assert.equal(sendActions[0]?.action, "send_group_msg");
        assert.equal(getGroupMemberActorBinding(20001, 10001)?.conversationId, "conv-group-1");
    });
});
