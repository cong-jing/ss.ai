import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import { openDatabase } from "../src/index.js";

describe("user_preferences schema migration", () => {
    it("removes the legacy current_conversation_id column while preserving data", () => {
        const dbPath = path.join(os.tmpdir(), `ss-ai-user-preferences-${crypto.randomUUID()}.db`);

        try {
            const legacy = new Database(dbPath);
            legacy.exec(`
                CREATE TABLE user_preferences (
                    user_id                 TEXT PRIMARY KEY,
                    current_character_id    TEXT,
                    current_conversation_id TEXT,
                    created_at              TEXT NOT NULL,
                    updated_at              TEXT NOT NULL
                );
                INSERT INTO user_preferences (
                    user_id,
                    current_character_id,
                    current_conversation_id,
                    created_at,
                    updated_at
                ) VALUES (
                    'user-1',
                    'character-1',
                    'conversation-1',
                    '2026-01-01T00:00:00.000Z',
                    '2026-01-01T00:00:00.000Z'
                );
            `);
            legacy.close();

            const { sqlite } = openDatabase(dbPath);
            const columns = sqlite.prepare(`PRAGMA table_info('user_preferences')`).all() as Array<{
                name: string;
            }>;
            const row = sqlite.prepare(`
                SELECT user_id, current_character_id, model_assignments_json
                FROM user_preferences
                WHERE user_id = 'user-1'
            `).get() as {
                user_id: string;
                current_character_id: string | null;
                model_assignments_json: string;
            };
            sqlite.close();

            assert.equal(columns.some((column) => column.name === "current_conversation_id"), false);
            assert.deepEqual(row, {
                user_id: "user-1",
                current_character_id: "character-1",
                model_assignments_json: "{}",
            });
        } finally {
            fs.rmSync(dbPath, { force: true });
            fs.rmSync(`${dbPath}-wal`, { force: true });
            fs.rmSync(`${dbPath}-shm`, { force: true });
        }
    });
});
