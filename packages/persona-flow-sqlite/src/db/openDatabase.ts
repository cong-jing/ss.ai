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

    // Keep provider credentials durable across restarts. Older prototype builds
    // recreated this table on boot, which erased user API keys.
    sqlite.exec(`
        CREATE TABLE IF NOT EXISTS user_provider_credentials (
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
            kind                  TEXT NOT NULL DEFAULT 'user_text',
            display_text          TEXT NOT NULL DEFAULT '',
            created_at            TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS turn_events (
            id             TEXT PRIMARY KEY,
            message_id     TEXT NOT NULL,
            conversation_id TEXT NOT NULL,
            seq            INTEGER NOT NULL,
            type           TEXT NOT NULL,
            payload_json   TEXT NOT NULL,
            schema_version INTEGER NOT NULL DEFAULT 1,
            created_at     TEXT NOT NULL
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
    // No compatibility migration for older provider credential shapes yet.

    const userPreferenceColumns = sqlite.prepare(`PRAGMA table_info('user_preferences')`).all() as Array<{
        name: string;
    }>;
    const userPreferenceColumnNames = new Set(userPreferenceColumns.map((column) => column.name));
    const hasLegacyCurrentConversationColumn = userPreferenceColumnNames.has("current_conversation_id");
    const hasModelAssignmentsColumn = userPreferenceColumnNames.has("model_assignments_json");

    if (hasLegacyCurrentConversationColumn) {
        const modelAssignmentsExpr = hasModelAssignmentsColumn
            ? `COALESCE(model_assignments_json, '{}')`
            : `'{}'`;
        sqlite.exec(`
            CREATE TABLE IF NOT EXISTS user_preferences_new (
                user_id                TEXT PRIMARY KEY,
                current_character_id   TEXT,
                model_assignments_json TEXT NOT NULL DEFAULT '{}',
                created_at             TEXT NOT NULL,
                updated_at             TEXT NOT NULL
            );
            INSERT INTO user_preferences_new (
                user_id,
                current_character_id,
                model_assignments_json,
                created_at,
                updated_at
            )
                SELECT
                    user_id,
                    current_character_id,
                    ${modelAssignmentsExpr},
                    created_at,
                    updated_at
                FROM user_preferences;
            DROP TABLE user_preferences;
            ALTER TABLE user_preferences_new RENAME TO user_preferences;
        `);
    }

    // Recreate messages table when legacy columns exist or required columns are missing.
    const messageColumns = sqlite.prepare(`PRAGMA table_info('messages')`).all() as Array<{ name: string }>;
    const messageColumnNames = new Set(messageColumns.map((column) => column.name));
    const hasRoleColumn = messageColumnNames.has("role");
    const hasUserIdColumn = messageColumnNames.has("user_id");
    const hasSenderActorIdColumn = messageColumnNames.has("sender_actor_id");
    const hasLegacySenderColumn = messageColumnNames.has("sender_participant_id");
    const hasConversationIdColumn = messageColumnNames.has("conversation_id");
    const hasContentColumn = messageColumnNames.has("content");
    const hasKindColumn = messageColumnNames.has("kind");
    const hasDisplayTextColumn = messageColumnNames.has("display_text");
    const hasCreatedAtColumn = messageColumnNames.has("created_at");

    const needsMessagesRebuild =
        hasRoleColumn ||
        hasUserIdColumn ||
        !hasSenderActorIdColumn ||
        !hasConversationIdColumn ||
        !hasKindColumn ||
        !hasDisplayTextColumn ||
        !hasCreatedAtColumn;

    if (needsMessagesRebuild) {
        const senderExpr = hasSenderActorIdColumn
            ? `COALESCE(sender_actor_id, '')`
            : hasLegacySenderColumn
                ? `COALESCE(sender_participant_id, '')`
                : `''`;
        const displayTextExpr = hasDisplayTextColumn
            ? `COALESCE(display_text, '')`
            : hasContentColumn
                ? `COALESCE(content, '')`
                : `''`;
        const kindExpr = hasKindColumn
            ? `COALESCE(kind, 'user_text')`
            : `'user_text'`;
        sqlite.exec(`
            CREATE TABLE IF NOT EXISTS messages_new (
                id                   TEXT PRIMARY KEY,
                conversation_id      TEXT NOT NULL,
                sender_actor_id      TEXT NOT NULL DEFAULT '',
                kind                 TEXT NOT NULL DEFAULT 'user_text',
                display_text         TEXT NOT NULL DEFAULT '',
                created_at           TEXT NOT NULL
            );
            INSERT INTO messages_new (id, conversation_id, sender_actor_id, kind, display_text, created_at)
                SELECT id, conversation_id, ${senderExpr}, ${kindExpr}, ${displayTextExpr}, created_at
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
        CREATE INDEX IF NOT EXISTS idx_turn_events_message_seq
            ON turn_events(message_id, seq)
    `);
    sqlite.exec(`
        CREATE INDEX IF NOT EXISTS idx_turn_events_conversation_type_created
            ON turn_events(conversation_id, type, created_at DESC)
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

    // ── memory write subsystem (Batch 3.5) ──────────────────────────────
    // Four tables back the ports defined in
    // `@ss-ai/persona-flow/memory`. Every memory belongs to exactly
    // one character world, so `character_id` is required on every
    // row that carries one; `scope` only classifies the memory
    // inside that world and never lets it cross characters. The
    // tables live in the core DB (not per-character DBs) so the
    // brute-force cosine scan can run a single query per
    // `(user_id, character_id, scope, type)` bucket regardless of
    // how many characters the user has.
    //
    // Batch 3.5 stripped `embedding_json` / `normalized_text` /
    // `reason` off `memory_candidates` and dropped the
    // `memory_decisions` audit table outright. The candidate row is
    // now just raw intake + processing state; downstream evidence
    // lives on `memory_staging` and is linked back via the
    // `memory_staging_sources` table. `memory_retained` is the
    // Batch 4 consolidation target, created empty here so the
    // debug surface and storage adapter can be wired now.
    //
    // No backward compatibility: pre-3.5 layouts (`memories`,
    // `memory_decisions`, the old fat `memory_candidates`) are
    // dropped when detected. Existing dev DBs lose their candidate
    // history on first open after the migration.

    // 1) Drop legacy tables outright.
    sqlite.exec(`
        DROP TABLE IF EXISTS memories;
        DROP TABLE IF EXISTS memory_decisions;
    `);

    // 2) If memory_candidates predates Batch 3.5 (still has the
    //    old `normalized_text` / `embedding_json` / `reason`
    //    columns), drop it so the new CREATE below installs the
    //    Batch 3.5 layout. Otherwise leave it intact.
    const candidateColumns = sqlite
        .prepare(`PRAGMA table_info(memory_candidates)`)
        .all() as Array<{ name: string }>;
    if (candidateColumns.length > 0) {
        const names = new Set(candidateColumns.map((c) => c.name));
        const isLegacyShape =
            names.has("normalized_text")
            || names.has("embedding_json")
            || names.has("reason")
            || !names.has("candidate_reason")
            || !names.has("status_reason");
        if (isLegacyShape) {
            sqlite.exec(`DROP TABLE memory_candidates`);
        }
    }

    sqlite.exec(`
        CREATE TABLE IF NOT EXISTS memory_candidates (
            id                    TEXT PRIMARY KEY,
            user_id               TEXT NOT NULL,
            character_id          TEXT NOT NULL,
            conversation_id       TEXT NOT NULL,
            user_message_id       TEXT NOT NULL,
            assistant_message_id  TEXT NOT NULL,
            request_id            TEXT NOT NULL,
            model_call_purpose    TEXT NOT NULL,
            seq                   INTEGER NOT NULL,
            scope                 TEXT NOT NULL,
            type                  TEXT NOT NULL,
            text                  TEXT NOT NULL,
            related_entities_json TEXT NOT NULL DEFAULT '[]',
            tags_json             TEXT NOT NULL DEFAULT '[]',
            candidate_reason      TEXT,
            status                TEXT NOT NULL,
            status_reason         TEXT,
            schema_version        INTEGER NOT NULL,
            created_at            TEXT NOT NULL,
            updated_at            TEXT NOT NULL
        );

        -- Status scan: the staging processor pulls pending candidates by user + character.
        CREATE INDEX IF NOT EXISTS idx_memory_candidates_user_character_status_created
            ON memory_candidates(user_id, character_id, status, created_at);

        -- Debug surface: list-by-turn for the assistant message under review.
        CREATE INDEX IF NOT EXISTS idx_memory_candidates_turn
            ON memory_candidates(user_id, conversation_id, assistant_message_id, seq);

        CREATE TABLE IF NOT EXISTS memory_staging (
            id                    TEXT PRIMARY KEY,
            user_id               TEXT NOT NULL,
            character_id          TEXT NOT NULL,
            scope                 TEXT NOT NULL,
            type                  TEXT NOT NULL,
            text                  TEXT NOT NULL,
            normalized_text       TEXT NOT NULL,
            related_entities_json TEXT NOT NULL DEFAULT '[]',
            tags_json             TEXT NOT NULL DEFAULT '[]',
            status                TEXT NOT NULL,
            status_reason         TEXT,
            occurrence_count      INTEGER NOT NULL DEFAULT 1,
            first_seen_at         TEXT NOT NULL,
            last_seen_at          TEXT NOT NULL,
            embedding_json        TEXT,
            schema_version        INTEGER NOT NULL,
            created_at            TEXT NOT NULL,
            updated_at            TEXT NOT NULL
        );

        -- Bucket scan: list staging rows by user + character + scope + type + status.
        CREATE INDEX IF NOT EXISTS idx_memory_staging_user_character_scope_type_status
            ON memory_staging(user_id, character_id, scope, type, status);

        -- Exact-duplicate lookup driven by the staging processor.
        CREATE INDEX IF NOT EXISTS idx_memory_staging_user_character_scope_type_normtext
            ON memory_staging(user_id, character_id, scope, type, normalized_text);

        CREATE TABLE IF NOT EXISTS memory_staging_sources (
            memory_staging_id  TEXT NOT NULL,
            candidate_id       TEXT NOT NULL UNIQUE,
            candidate_seq      INTEGER NOT NULL,
            created_at         TEXT NOT NULL,
            PRIMARY KEY (memory_staging_id, candidate_id)
        );

        CREATE TABLE IF NOT EXISTS memory_retained (
            id                    TEXT PRIMARY KEY,
            user_id               TEXT NOT NULL,
            character_id          TEXT NOT NULL,
            scope                 TEXT NOT NULL,
            type                  TEXT NOT NULL,
            text                  TEXT NOT NULL,
            normalized_text       TEXT NOT NULL,
            related_entities_json TEXT NOT NULL DEFAULT '[]',
            tags_json             TEXT NOT NULL DEFAULT '[]',
            source_staging_id     TEXT,
            status                TEXT NOT NULL,
            importance            REAL NOT NULL,
            embedding_json        TEXT,
            schema_version        INTEGER NOT NULL,
            created_at            TEXT NOT NULL,
            updated_at            TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_memory_retained_user_character_scope_type_status
            ON memory_retained(user_id, character_id, scope, type, status);
    `);

    // Obsolete pre-3.5 indexes — names changed; drop the old ones
    // so PRAGMA index_list doesn't list zombies.
    sqlite.exec(`DROP INDEX IF EXISTS idx_memory_candidates_user_status_created`);
    sqlite.exec(`DROP INDEX IF EXISTS idx_memories_user_character_scope_type_status`);
    sqlite.exec(`DROP INDEX IF EXISTS idx_memories_user_character_scope_type_normtext_status`);
    sqlite.exec(`DROP INDEX IF EXISTS idx_memories_user_scope_type_normtext_status`);
    sqlite.exec(`DROP INDEX IF EXISTS idx_memory_decisions_candidate`);
    sqlite.exec(`DROP INDEX IF EXISTS idx_memory_decisions_user_decision_created`);

    const db = drizzle(sqlite, { schema });

    return { sqlite, db };
}
