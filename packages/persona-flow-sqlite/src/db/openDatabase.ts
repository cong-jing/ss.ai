import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema.js";

export type SqliteDb = ReturnType<typeof Database>;
export type DrizzleDb = ReturnType<typeof drizzle<typeof schema>>;

export interface OpenDatabaseResult {
    sqlite: SqliteDb;
    db: DrizzleDb;
}

export type DbLog = (message: unknown, ...args: any[]) => void;

export function openDatabase(path: string, dblog?: DbLog): OpenDatabaseResult {
    const sqlite = new Database(path, { verbose: dblog });

    sqlite.pragma("foreign_keys = ON");
    sqlite.pragma("journal_mode = WAL");

    // Create tables (idempotent via IF NOT EXISTS)
    sqlite.exec(`
        CREATE TABLE IF NOT EXISTS messages (
            id              TEXT PRIMARY KEY,
            user_id         TEXT NOT NULL DEFAULT 'default',
            conversation_id TEXT NOT NULL,
            role            TEXT NOT NULL,
            content         TEXT NOT NULL,
            created_at      TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_messages_user_conversation_created
            ON messages(user_id, conversation_id, created_at DESC);

        CREATE TABLE IF NOT EXISTS characters (
            id                     TEXT PRIMARY KEY,
            user_id                TEXT NOT NULL DEFAULT 'default',
            name                   TEXT NOT NULL,
            display_name           TEXT,
            description            TEXT,
            persona_prompt         TEXT NOT NULL,
            greeting_message       TEXT,
            avatar_url             TEXT,
            model_config_json      TEXT NOT NULL DEFAULT '{}',
            generation_config_json TEXT NOT NULL DEFAULT '{}',
            memory_config_json     TEXT NOT NULL DEFAULT '{}',
            language               TEXT DEFAULT 'zh-CN',
            status                 TEXT NOT NULL DEFAULT 'active',
            created_at             TEXT NOT NULL,
            updated_at             TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_characters_user_status_updated
            ON characters(user_id, status, updated_at DESC);

        CREATE TABLE IF NOT EXISTS user_profiles (
            user_id           TEXT PRIMARY KEY,
            name              TEXT NOT NULL,
            preferred_address TEXT,
            bio               TEXT NOT NULL DEFAULT '',
            metadata_json     TEXT NOT NULL DEFAULT '{}',
            created_at        TEXT NOT NULL,
            updated_at        TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS user_preferences (
            user_id                 TEXT PRIMARY KEY,
            current_character_id    TEXT,
            current_conversation_id TEXT,
            function_models_json    TEXT NOT NULL DEFAULT '{}',
            created_at              TEXT NOT NULL,
            updated_at              TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS user_provider_credentials (
            user_id           TEXT NOT NULL,
            provider          TEXT NOT NULL,
            api_key_encrypted TEXT NOT NULL,
            created_at        TEXT NOT NULL,
            updated_at        TEXT NOT NULL,
            PRIMARY KEY (user_id, provider)
        );
    `);

    // Schema migrations: add user_id to pre-existing tables that lacked it.
    // ALTER TABLE ADD COLUMN throws if the column already exists — silently ignored.
    try { sqlite.exec(`ALTER TABLE messages ADD COLUMN user_id TEXT NOT NULL DEFAULT 'default'`); } catch { /* already exists */ }
    try { sqlite.exec(`ALTER TABLE characters ADD COLUMN user_id TEXT NOT NULL DEFAULT 'default'`); } catch { /* already exists */ }
    try { sqlite.exec(`ALTER TABLE characters ADD COLUMN language TEXT DEFAULT 'zh-CN'`); } catch { /* already exists */ }

    const db = drizzle(sqlite, { schema });

    return { sqlite, db };
}
