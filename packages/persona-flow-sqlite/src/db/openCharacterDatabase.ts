import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema.js";
import type { DbLog, DrizzleDb, OpenDatabaseResult } from "./openDatabase.js";

export function openCharacterDatabase(path: string, dblog?: DbLog): OpenDatabaseResult {
    const sqlite = new Database(path, { verbose: dblog });
    sqlite.pragma("foreign_keys = ON");
    sqlite.pragma("journal_mode = WAL");

    sqlite.exec(`
        CREATE TABLE IF NOT EXISTS messages (
            id                    TEXT PRIMARY KEY,
            conversation_id       TEXT NOT NULL,
            sender_actor_id       TEXT NOT NULL DEFAULT '',
            content               TEXT NOT NULL,
            created_at            TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_messages_conversation_created
            ON messages(conversation_id, created_at DESC);

        CREATE TABLE IF NOT EXISTS conversation_actors (
            id                    TEXT PRIMARY KEY,
            conversation_id       TEXT NOT NULL,
            role                  TEXT NOT NULL,
            source_type           TEXT NOT NULL,
            display_name          TEXT NOT NULL,
            user_profile_id       TEXT,
            character_id          TEXT,
            profile_snapshot_json TEXT,
            left_at               TEXT,
            created_at            TEXT NOT NULL,
            updated_at            TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_conv_actors_conversation
            ON conversation_actors(conversation_id);

        CREATE TABLE IF NOT EXISTS user_character_states (
            user_id                 TEXT NOT NULL,
            character_id            TEXT NOT NULL,
            current_conversation_id TEXT NOT NULL,
            created_at              TEXT NOT NULL,
            updated_at              TEXT NOT NULL,
            PRIMARY KEY (user_id, character_id)
        );
    `);

    const db: DrizzleDb = drizzle(sqlite, { schema });
    return { sqlite, db };
}
