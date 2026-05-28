import type { SqliteDb } from "@ss-ai/persona-flow-sqlite";

export interface LocalAuthUserRecord {
    id: string;
    username: string;
    passwordHash: string;
    displayName: string | null;
    createdAt: string;
    updatedAt: string;
}

export interface LocalAuthSessionRecord {
    id: string;
    userId: string;
    tokenHash: string;
    expiresAt: string;
    createdAt: string;
}

export class LocalAuthStore {
    readonly #sqlite: SqliteDb;

    constructor(sqlite: SqliteDb) {
        this.#sqlite = sqlite;
    }

    getUserByUsername(username: string): LocalAuthUserRecord | null {
        const row = this.#sqlite.prepare(`
            SELECT id, username, password_hash, display_name, created_at, updated_at
            FROM app_users
            WHERE username = ?
            LIMIT 1
        `).get(username) as {
            id: string;
            username: string;
            password_hash: string;
            display_name: string | null;
            created_at: string;
            updated_at: string;
        } | undefined;

        if (!row) return null;
        return {
            id: row.id,
            username: row.username,
            passwordHash: row.password_hash,
            displayName: row.display_name,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
        };
    }

    getUserById(userId: string): LocalAuthUserRecord | null {
        const row = this.#sqlite.prepare(`
            SELECT id, username, password_hash, display_name, created_at, updated_at
            FROM app_users
            WHERE id = ?
            LIMIT 1
        `).get(userId) as {
            id: string;
            username: string;
            password_hash: string;
            display_name: string | null;
            created_at: string;
            updated_at: string;
        } | undefined;

        if (!row) return null;
        return {
            id: row.id,
            username: row.username,
            passwordHash: row.password_hash,
            displayName: row.display_name,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
        };
    }

    createUser(input: {
        id: string;
        username: string;
        passwordHash: string;
        displayName: string | null;
        createdAt: string;
        updatedAt: string;
    }): void {
        this.#sqlite.prepare(`
            INSERT INTO app_users (id, username, password_hash, display_name, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
        `).run(
            input.id,
            input.username,
            input.passwordHash,
            input.displayName,
            input.createdAt,
            input.updatedAt,
        );
    }

    createSession(input: {
        id: string;
        userId: string;
        tokenHash: string;
        expiresAt: string;
        createdAt: string;
    }): void {
        this.#sqlite.prepare(`
            INSERT INTO app_sessions (id, user_id, token_hash, expires_at, created_at)
            VALUES (?, ?, ?, ?, ?)
        `).run(
            input.id,
            input.userId,
            input.tokenHash,
            input.expiresAt,
            input.createdAt,
        );
    }

    getSessionByTokenHash(tokenHash: string): LocalAuthSessionRecord | null {
        const row = this.#sqlite.prepare(`
            SELECT id, user_id, token_hash, expires_at, created_at
            FROM app_sessions
            WHERE token_hash = ?
            LIMIT 1
        `).get(tokenHash) as {
            id: string;
            user_id: string;
            token_hash: string;
            expires_at: string;
            created_at: string;
        } | undefined;

        if (!row) return null;
        return {
            id: row.id,
            userId: row.user_id,
            tokenHash: row.token_hash,
            expiresAt: row.expires_at,
            createdAt: row.created_at,
        };
    }

    deleteSessionByTokenHash(tokenHash: string): void {
        this.#sqlite.prepare(`DELETE FROM app_sessions WHERE token_hash = ?`).run(tokenHash);
    }

    deleteExpiredSessions(nowIso: string): void {
        this.#sqlite.prepare(`DELETE FROM app_sessions WHERE expires_at <= ?`).run(nowIso);
    }
}
