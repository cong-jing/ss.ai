import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { DEFAULT_INTERACTION_MODE } from "@ss-ai/contracts";
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
            interaction_mode            TEXT NOT NULL DEFAULT '${DEFAULT_INTERACTION_MODE}',
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
            model_assignments_json  TEXT NOT NULL DEFAULT '{}',
            created_at              TEXT NOT NULL,
            updated_at              TEXT NOT NULL
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
    `);

    sqlite.exec(`
        CREATE INDEX IF NOT EXISTS idx_conv_actors_conversation
            ON conversation_actors(conversation_id)
    `);

    // Prototype stage: force canonical credential table schema on every boot.
    sqlite.exec(`
        DROP TABLE IF EXISTS user_provider_credentials;
        CREATE TABLE user_provider_credentials (
            user_id            TEXT NOT NULL,
            provider           TEXT NOT NULL,
            api_key_ciphertext TEXT NOT NULL,
            created_at         TEXT NOT NULL,
            updated_at         TEXT NOT NULL,
            PRIMARY KEY (user_id, provider)
        );
    `);

    // Create the latest messages table for fresh databases.
    sqlite.exec(`
        CREATE TABLE IF NOT EXISTS messages (
            id                    TEXT PRIMARY KEY,
            conversation_id       TEXT NOT NULL,
            sender_actor_id       TEXT NOT NULL DEFAULT '',
            content               TEXT NOT NULL,
            created_at            TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS app_users (
            id            TEXT PRIMARY KEY,
            username      TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            display_name  TEXT,
            created_at    TEXT NOT NULL,
            updated_at    TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS app_sessions (
            id         TEXT PRIMARY KEY,
            user_id    TEXT NOT NULL,
            token_hash TEXT NOT NULL UNIQUE,
            expires_at TEXT NOT NULL,
            created_at TEXT NOT NULL
        );
    `);

    // Schema migrations.
    // ALTER TABLE ADD COLUMN throws if the column already exists — silently ignored.
    try { sqlite.exec(`ALTER TABLE characters ADD COLUMN user_id TEXT NOT NULL DEFAULT 'default'`); } catch { /* already exists */ }
    try { sqlite.exec(`ALTER TABLE characters ADD COLUMN language TEXT DEFAULT 'zh-CN'`); } catch { /* already exists */ }
    try { sqlite.exec(`ALTER TABLE characters ADD COLUMN interaction_mode TEXT NOT NULL DEFAULT '${DEFAULT_INTERACTION_MODE}'`); } catch { /* already exists */ }
    try { sqlite.exec(`ALTER TABLE user_preferences ADD COLUMN model_assignments_json TEXT NOT NULL DEFAULT '{}'`); } catch { /* already exists */ }
    // No compatibility migration for provider credentials in prototype mode.

    // Recreate messages table when legacy columns exist or required columns are missing.
    const messageColumns = sqlite.prepare(`PRAGMA table_info('messages')`).all() as Array<{ name: string }>;
    const messageColumnNames = new Set(messageColumns.map((column) => column.name));
    const hasRoleColumn = messageColumnNames.has("role");
    const hasUserIdColumn = messageColumnNames.has("user_id");
    const hasSenderActorIdColumn = messageColumnNames.has("sender_actor_id");
    const hasLegacySenderColumn = messageColumnNames.has("sender_participant_id");
    const hasConversationIdColumn = messageColumnNames.has("conversation_id");
    const hasContentColumn = messageColumnNames.has("content");
    const hasCreatedAtColumn = messageColumnNames.has("created_at");

    const needsMessagesRebuild =
        hasRoleColumn ||
        hasUserIdColumn ||
        !hasSenderActorIdColumn ||
        !hasConversationIdColumn ||
        !hasContentColumn ||
        !hasCreatedAtColumn;

    if (needsMessagesRebuild) {
        const senderExpr = hasSenderActorIdColumn
            ? `COALESCE(sender_actor_id, '')`
            : hasLegacySenderColumn
                ? `COALESCE(sender_participant_id, '')`
                : `''`;
        sqlite.exec(`
            CREATE TABLE IF NOT EXISTS messages_new (
                id                   TEXT PRIMARY KEY,
                conversation_id      TEXT NOT NULL,
                sender_actor_id      TEXT NOT NULL DEFAULT '',
                content              TEXT NOT NULL,
                created_at           TEXT NOT NULL
            );
            INSERT INTO messages_new (id, conversation_id, sender_actor_id, content, created_at)
                SELECT id, conversation_id, ${senderExpr}, content, created_at
                FROM messages;
            DROP TABLE messages;
            ALTER TABLE messages_new RENAME TO messages;
        `);
    }

    // Ensure we only keep the latest index strategy for messages.
    sqlite.exec(`DROP INDEX IF EXISTS idx_messages_user_conversation_created`);
    sqlite.exec(`
        CREATE INDEX IF NOT EXISTS idx_messages_conversation_created
            ON messages(conversation_id, created_at DESC)
    `);
    sqlite.exec(`
        CREATE INDEX IF NOT EXISTS idx_app_sessions_user_id
            ON app_sessions(user_id)
    `);
    sqlite.exec(`
        CREATE INDEX IF NOT EXISTS idx_app_sessions_expires_at
            ON app_sessions(expires_at)
    `);

    // Backfill migration for legacy databases that may not enforce uniqueness
    // on app_sessions.token_hash yet. We keep the latest row per token_hash
    // before ensuring a unique index exists to avoid DDL failure on duplicates.
    const appSessionIndexes = sqlite.prepare(`PRAGMA index_list('app_sessions')`).all() as Array<{
        name: string;
        unique: number;
    }>;
    const hasUniqueTokenHashIndex = appSessionIndexes.some((indexRow) => {
        if (Number(indexRow.unique) !== 1) {
            return false;
        }

        const indexName = indexRow.name.replace(/'/g, "''");
        const indexColumns = sqlite.prepare(`PRAGMA index_info('${indexName}')`).all() as Array<{
            name: string;
        }>;

        return indexColumns.length === 1 && indexColumns[0]?.name === "token_hash";
    });

    if (!hasUniqueTokenHashIndex) {
        const migrateAppSessionTokenHashes = sqlite.transaction(() => {
            sqlite.exec(`
                DELETE FROM app_sessions
                WHERE rowid IN (
                    SELECT rowid
                    FROM (
                        SELECT
                            rowid,
                            ROW_NUMBER() OVER (
                                PARTITION BY token_hash
                                ORDER BY expires_at DESC, created_at DESC, rowid DESC
                            ) AS duplicate_rank
                        FROM app_sessions
                    ) ranked_sessions
                    WHERE duplicate_rank > 1
                )
            `);
            sqlite.exec(`
                CREATE UNIQUE INDEX IF NOT EXISTS idx_app_sessions_token_hash_unique
                    ON app_sessions(token_hash)
            `);
        });

        migrateAppSessionTokenHashes();
    }

    const db = drizzle(sqlite, { schema });

    return { sqlite, db };
}
