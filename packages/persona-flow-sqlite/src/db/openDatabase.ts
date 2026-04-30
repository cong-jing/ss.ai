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
    // 打开（或创建）SQLite 文件
    const sqlite = new Database(path, { verbose: dblog, });

    // 性能和安全配置
    sqlite.pragma("foreign_keys = ON");
    sqlite.pragma("journal_mode = WAL");

    // 自动建表 —— 开发阶段用 raw SQL 即可，无需 migration 系统
    sqlite.exec(`
        CREATE TABLE IF NOT EXISTS messages (
            id              TEXT PRIMARY KEY,
            conversation_id TEXT NOT NULL,
            role            TEXT NOT NULL,
            content         TEXT NOT NULL,
            created_at      TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_messages_conversation_created
            ON messages(conversation_id, created_at DESC);

        CREATE TABLE IF NOT EXISTS characters (
            id                    TEXT PRIMARY KEY,
            name                  TEXT NOT NULL,
            display_name          TEXT,
            description           TEXT,
            persona_prompt        TEXT NOT NULL,
            greeting_message      TEXT,
            avatar_url            TEXT,
            model_config_json      TEXT NOT NULL DEFAULT '{}',
            generation_config_json TEXT NOT NULL DEFAULT '{}',
            memory_config_json     TEXT NOT NULL DEFAULT '{}',
            status                TEXT NOT NULL DEFAULT 'active',
            created_at            TEXT NOT NULL,
            updated_at            TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_characters_status_updated
            ON characters(status, updated_at DESC);
    `);

    // 包裹成 Drizzle 实例，传入 schema 让它知道表结构
    const db = drizzle(sqlite, { schema });

    return { sqlite, db };
}
