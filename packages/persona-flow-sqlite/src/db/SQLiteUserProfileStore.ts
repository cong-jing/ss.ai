import { eq } from "drizzle-orm";
import { userProfiles, type UserProfileRow } from "./schema.js";
import type { DrizzleDb } from "./openDatabase.js";
import type { UserProfile, UserProfileStore } from "@ss-ai/persona-flow";

function rowToProfile(row: UserProfileRow): UserProfile {
    let metadata: Record<string, unknown> = {};
    try {
        const parsed = JSON.parse(row.metadataJson);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            metadata = parsed as Record<string, unknown>;
        }
    } catch { /* leave as {} */ }

    return {
        userId: row.userId,
        name: row.name,
        preferredAddress: row.preferredAddress ?? null,
        bio: row.bio,
        metadata,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
    };
}

export class SQLiteUserProfileStore implements UserProfileStore {
    constructor(private readonly db: DrizzleDb) { }

    async getUserProfile(userId: string): Promise<UserProfile | null> {
        const rows = await this.db
            .select()
            .from(userProfiles)
            .where(eq(userProfiles.userId, userId))
            .limit(1);

        return rows.length > 0 ? rowToProfile(rows[0]) : null;
    }

    async upsertUserProfile(profile: UserProfile): Promise<void> {
        const row = {
            userId: profile.userId,
            name: profile.name,
            preferredAddress: profile.preferredAddress ?? null,
            bio: profile.bio,
            metadataJson: JSON.stringify(profile.metadata),
            createdAt: profile.createdAt,
            updatedAt: profile.updatedAt,
        };

        await this.db
            .insert(userProfiles)
            .values(row)
            .onConflictDoUpdate({
                target: userProfiles.userId,
                set: {
                    name: row.name,
                    preferredAddress: row.preferredAddress,
                    bio: row.bio,
                    metadataJson: row.metadataJson,
                    updatedAt: row.updatedAt,
                    // createdAt intentionally NOT updated
                },
            });
    }
}
