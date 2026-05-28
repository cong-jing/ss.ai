import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import { openDatabase } from "../src/index.js";

describe("SQLite migrations - app_sessions token_hash uniqueness", () => {
    it("deduplicates legacy duplicate token_hash rows by keeping the latest session before adding unique index", () => {
        const dbPath = path.join(os.tmpdir(), `ss-ai-sessions-migration-${crypto.randomUUID()}.db`);

        try {
            const legacyDb = new Database(dbPath);
            legacyDb.exec(`
                CREATE TABLE app_sessions (
                    id         TEXT PRIMARY KEY,
                    user_id    TEXT NOT NULL,
                    token_hash TEXT NOT NULL,
                    expires_at TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );
            `);
            legacyDb.exec(`
                INSERT INTO app_sessions (id, user_id, token_hash, expires_at, created_at) VALUES
                ('s1', 'u1', 'dup-token', '2030-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
                ('s2', 'u1', 'dup-token', '2030-01-02T00:00:00.000Z', '2026-01-02T00:00:00.000Z'),
                ('s3', 'u1', 'unique-token', '2030-01-03T00:00:00.000Z', '2026-01-03T00:00:00.000Z');
            `);
            legacyDb.close();

            const { sqlite } = openDatabase(dbPath);

            const duplicates = sqlite.prepare(`
                SELECT token_hash, COUNT(*) AS cnt
                FROM app_sessions
                GROUP BY token_hash
                HAVING COUNT(*) > 1
            `).all() as Array<{ token_hash: string; cnt: number }>;
            assert.equal(duplicates.length, 0, "duplicate token_hash rows should be removed during migration");

            const keptSession = sqlite.prepare(`
                SELECT id, expires_at, created_at
                FROM app_sessions
                WHERE token_hash = 'dup-token'
            `).get() as { id: string; expires_at: string; created_at: string } | undefined;
            assert.deepEqual(keptSession, {
                id: "s2",
                expires_at: "2030-01-02T00:00:00.000Z",
                created_at: "2026-01-02T00:00:00.000Z",
            }, "migration should keep the latest duplicate session record");

            const indexes = sqlite.prepare(`PRAGMA index_list('app_sessions')`).all() as Array<{ name: string; unique: number }>;
            const hasUniqueTokenHashIndex = indexes.some((indexRow) => {
                if (Number(indexRow.unique) !== 1) {
                    return false;
                }

                const escapedName = indexRow.name.replace(/'/g, "''");
                const indexColumns = sqlite.prepare(`PRAGMA index_info('${escapedName}')`).all() as Array<{ name: string }>;
                return indexColumns.length === 1 && indexColumns[0]?.name === "token_hash";
            });

            assert.equal(hasUniqueTokenHashIndex, true, "token_hash should have a unique index after migration");
            sqlite.close();
        } finally {
            fs.rmSync(dbPath, { force: true });
        }
    });
});
