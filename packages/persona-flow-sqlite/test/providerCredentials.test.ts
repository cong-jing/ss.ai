import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { openDatabase, SQLiteUserProviderCredentialStore } from "../src/index.js";

describe("SQLiteUserProviderCredentialStore persistence", () => {
    it("keeps provider credentials after reopening the database", async () => {
        const dbPath = path.join(os.tmpdir(), `ss-ai-provider-credentials-${crypto.randomUUID()}.db`);
        try {
            const first = openDatabase(dbPath);
            const firstStore = new SQLiteUserProviderCredentialStore(first.db);
            await firstStore.upsertCredential({
                userId: "user-1",
                provider: "mistral.ai",
                encryptedApiKey: "test-key",
                createdAt: "2026-01-01T00:00:00.000Z",
                updatedAt: "2026-01-01T00:00:00.000Z",
            });
            first.sqlite.close();

            const second = openDatabase(dbPath);
            const secondStore = new SQLiteUserProviderCredentialStore(second.db);
            const credential = await secondStore.getCredential({
                userId: "user-1",
                provider: "mistral.ai",
            });
            second.sqlite.close();

            assert.equal(credential?.encryptedApiKey, "test-key");
        } finally {
            fs.rmSync(dbPath, { force: true });
            fs.rmSync(`${dbPath}-wal`, { force: true });
            fs.rmSync(`${dbPath}-shm`, { force: true });
        }
    });
});
