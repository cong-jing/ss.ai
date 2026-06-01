import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { AppStores, Conversation } from "@ss-ai/persona-flow";
import { createSqliteStores, openDatabase } from "../src/index.js";

function makeConversation(overrides?: Partial<Conversation>): Conversation {
    return {
        id: crypto.randomUUID(),
        userId: "user-router",
        characterId: "char-router",
        title: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        ...overrides,
    };
}

describe("CharacterDbRouter-backed stores", () => {
    it("updates and soft-deletes actors in the per-character database", async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ss-ai-character-router-"));
        const dbPath = path.join(tempDir, "core.db");
        const characterDbDir = path.join(tempDir, "characters");
        const { sqlite, db } = openDatabase(dbPath);
        const stores = createSqliteStores({ db, characterDbDir });

        try {
            const conversation = makeConversation();
            await stores.conversation.createConversation(conversation, { selfDisplayName: "AI" });
            const actor = await stores.conversationActor.addConversationActor({
                conversationId: conversation.id,
                role: "other",
                sourceType: "local_actor",
                displayName: "Before",
                profileSnapshotJson: "{}",
            });

            await stores.conversationActor.updateConversationActor({
                id: actor.id,
                displayName: "After",
            });

            const afterUpdate = await stores.conversationActor.getActorById(actor.id);
            assert.equal(afterUpdate?.displayName, "After");

            await stores.conversationActor.updateConversationActor({
                id: actor.id,
                leftAt: "2026-01-01T00:00:00.000Z",
            });

            const activeActors = await stores.conversationActor.listConversationActors({
                conversationId: conversation.id,
                activeOnly: true,
            });
            assert.equal(activeActors.some(item => item.id === actor.id), false);
        } finally {
            (stores as AppStores & { close?: () => void }).close?.();
            sqlite.close();
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });
});
