import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
    configureConversationStore,
    getConversationId,
    setConversationId,
    getPrivateActorBinding,
    setPrivateActorBinding,
    getGroupMemberActorBinding,
    setGroupMemberActorBinding,
} from "../src/conversationStore.js";

const tempDirs: string[] = [];

function createTempStorePath(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "qq-bot-store-test-"));
    tempDirs.push(dir);
    return path.join(dir, "conversation-map.json");
}

afterEach(() => {
    while (tempDirs.length > 0) {
        const dir = tempDirs.pop();
        if (dir) fs.rmSync(dir, { recursive: true, force: true });
    }
});

describe("conversationStore", () => {
    it("stores and reads conversation ids and actor bindings", () => {
        const storePath = createTempStorePath();
        configureConversationStore(storePath);

        setConversationId("user", 10001, "conv-private-1");
        setConversationId("group", 20001, "conv-group-1");
        setPrivateActorBinding(10001, { conversationId: "conv-private-1", actorId: "actor-private-1" });
        setGroupMemberActorBinding(20001, 10001, { conversationId: "conv-group-1", actorId: "actor-group-1" });

        assert.equal(getConversationId("user", 10001), "conv-private-1");
        assert.equal(getConversationId("group", 20001), "conv-group-1");
        assert.equal(getPrivateActorBinding(10001)?.actorId, "actor-private-1");
        assert.equal(getGroupMemberActorBinding(20001, 10001)?.actorId, "actor-group-1");
    });

    it("migrates legacy conversation map format", () => {
        const storePath = createTempStorePath();
        fs.mkdirSync(path.dirname(storePath), { recursive: true });
        fs.writeFileSync(
            storePath,
            JSON.stringify({ "user:42": "conv-legacy" }, null, 2),
            "utf-8",
        );

        configureConversationStore(storePath);

        assert.equal(getConversationId("user", 42), "conv-legacy");

        setPrivateActorBinding(42, { conversationId: "conv-legacy", actorId: "actor-legacy" });
        const parsed = JSON.parse(fs.readFileSync(storePath, "utf-8")) as {
            conversations?: Record<string, string>;
            privateActorBindings?: Record<string, { actorId: string }>;
        };

        assert.equal(parsed.conversations?.["user:42"], "conv-legacy");
        assert.equal(parsed.privateActorBindings?.["private:42"]?.actorId, "actor-legacy");
    });
});
