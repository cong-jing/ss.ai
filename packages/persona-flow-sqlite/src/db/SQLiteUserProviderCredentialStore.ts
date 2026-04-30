import { and, eq } from "drizzle-orm";
import { userProviderCredentials, type UserProviderCredentialRow } from "./schema.js";
import type { DrizzleDb } from "./openDatabase.js";
import type { UserProviderCredential, UserProviderCredentialStore } from "@ss-ai/persona-flow";

function rowToCredential(row: UserProviderCredentialRow): UserProviderCredential {
    return {
        userId: row.userId,
        provider: row.provider,
        apiKeyEncrypted: row.apiKeyEncrypted,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
    };
}

export class SQLiteUserProviderCredentialStore implements UserProviderCredentialStore {
    constructor(private readonly db: DrizzleDb) { }

    async getCredential(input: { userId: string; provider: string }): Promise<UserProviderCredential | null> {
        const rows = await this.db
            .select()
            .from(userProviderCredentials)
            .where(and(
                eq(userProviderCredentials.userId, input.userId),
                eq(userProviderCredentials.provider, input.provider),
            ))
            .limit(1);

        return rows.length > 0 ? rowToCredential(rows[0]) : null;
    }

    async upsertCredential(credential: UserProviderCredential): Promise<void> {
        const row = {
            userId: credential.userId,
            provider: credential.provider,
            apiKeyEncrypted: credential.apiKeyEncrypted,
            createdAt: credential.createdAt,
            updatedAt: credential.updatedAt,
        };

        await this.db
            .insert(userProviderCredentials)
            .values(row)
            .onConflictDoUpdate({
                target: [userProviderCredentials.userId, userProviderCredentials.provider],
                set: {
                    apiKeyEncrypted: row.apiKeyEncrypted,
                    updatedAt: row.updatedAt,
                },
            });
    }

    async deleteCredential(input: { userId: string; provider: string }): Promise<void> {
        await this.db
            .delete(userProviderCredentials)
            .where(and(
                eq(userProviderCredentials.userId, input.userId),
                eq(userProviderCredentials.provider, input.provider),
            ));
    }

    async listCredentials(userId: string): Promise<UserProviderCredential[]> {
        const rows = await this.db
            .select()
            .from(userProviderCredentials)
            .where(eq(userProviderCredentials.userId, userId));

        return rows.map(rowToCredential);
    }
}
