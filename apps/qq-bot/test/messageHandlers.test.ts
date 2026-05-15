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
    process.env.QQ_BOT_DRY_RUN = "1";
}

afterEach(() => {
    delete process.env.QQ_BOT_DRY_RUN;

    while (tempDirs.length > 0) {
        const dir = tempDirs.pop();
        if (dir) fs.rmSync(dir, { recursive: true, force: true });
    }
});

describe("message handlers", () => {
    it("private handler creates actor once and reuses binding", async () => {
        setupTempRuntime();

        const sendActions: Array<{ action: string; params: Record<string, unknown> }> = [];

        const context: MessageHandlerContext = {
            getCharacterId: () => "char-1",
            getBotSelfId: () => 999,
            getConfig: () => ({ isDryRun: true }),
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

        assert.equal(sendActions.length, 2);
        assert.equal(sendActions[0]?.action, "send_private_msg");
        const binding = getPrivateActorBinding(10001);
        assert.ok(binding);
        assert.ok(binding.actorId.startsWith("dry-run-actor-"));
        assert.ok(binding.conversationId.startsWith("dry-run-conversation-"));
    });

    it("group handler only processes @self messages", async () => {
        setupTempRuntime();

        const sendActions: Array<{ action: string; params: Record<string, unknown> }> = [];

        const context: MessageHandlerContext = {
            getCharacterId: () => "char-1",
            getBotSelfId: () => 999,
            getConfig: () => ({ isDryRun: true }),
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

        assert.equal(sendActions.length, 1);
        assert.equal(sendActions[0]?.action, "send_group_msg");
        const binding = getGroupMemberActorBinding(20001, 10001);
        assert.ok(binding);
        assert.ok(binding.actorId.startsWith("dry-run-actor-"));
        assert.ok(binding.conversationId.startsWith("dry-run-conversation-"));
    });
});
