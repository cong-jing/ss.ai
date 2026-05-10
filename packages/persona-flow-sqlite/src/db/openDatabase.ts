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

        CREATE TABLE IF NOT EXISTS conversations (
            id           TEXT PRIMARY KEY,
            user_id      TEXT NOT NULL,
            character_id TEXT NOT NULL,
            title        TEXT,
            created_at   TEXT NOT NULL,
            updated_at   TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_conversations_user_character_created
            ON conversations(user_id, character_id, created_at DESC);

        CREATE TABLE IF NOT EXISTS user_character_states (
            user_id                 TEXT NOT NULL,
            character_id            TEXT NOT NULL,
            current_conversation_id TEXT NOT NULL,
            created_at              TEXT NOT NULL,
            updated_at              TEXT NOT NULL,
            PRIMARY KEY (user_id, character_id)
        );

        CREATE TABLE IF NOT EXISTS conversation_participants (
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

        CREATE INDEX IF NOT EXISTS idx_conv_participants_conversation
            ON conversation_participants(conversation_id);
    `);

    // Schema migrations: add user_id to pre-existing tables that lacked it.
    // ALTER TABLE ADD COLUMN throws if the column already exists — silently ignored.
    try { sqlite.exec(`ALTER TABLE messages ADD COLUMN user_id TEXT NOT NULL DEFAULT 'default'`); } catch { /* already exists */ }
    try { sqlite.exec(`ALTER TABLE characters ADD COLUMN user_id TEXT NOT NULL DEFAULT 'default'`); } catch { /* already exists */ }
    try { sqlite.exec(`ALTER TABLE characters ADD COLUMN language TEXT DEFAULT 'zh-CN'`); } catch { /* already exists */ }
    // Migrate messages: add sender_participant_id if not present (pre-schema-change rows)
    try { sqlite.exec(`ALTER TABLE messages ADD COLUMN sender_participant_id TEXT NOT NULL DEFAULT ''`); } catch { /* already exists */ }

    // Recreate messages table to drop legacy user_id / role columns if they still exist.
    // We do this by checking for the role column; if present, migrate via table swap.
    const hasRoleColumn = (sqlite.prepare(
        `SELECT COUNT(*) as cnt FROM pragma_table_info('messages') WHERE name = 'role'`
    ).get() as { cnt: number }).cnt > 0;

    if (hasRoleColumn) {
        sqlite.exec(`
            CREATE TABLE IF NOT EXISTS messages_new (
                id                   TEXT PRIMARY KEY,
                conversation_id      TEXT NOT NULL,
                sender_participant_id TEXT NOT NULL DEFAULT '',
                content              TEXT NOT NULL,
                created_at           TEXT NOT NULL
            );
            INSERT INTO messages_new (id, conversation_id, sender_participant_id, content, created_at)
                SELECT id, conversation_id, COALESCE(sender_participant_id, ''), content, created_at
                FROM messages;
            DROP TABLE messages;
            ALTER TABLE messages_new RENAME TO messages;
        `);
    }

    const db = drizzle(sqlite, { schema });

    return { sqlite, db };
}
