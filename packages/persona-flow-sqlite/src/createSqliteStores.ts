import type { AppStores } from "@ss-ai/persona-flow";
import type { DrizzleDb } from "./db/openDatabase.js";
import { SQLiteChatStore } from "./db/SQLiteChatStore.js";
import { SQLiteCharacterStore } from "./db/SQLiteCharacterStore.js";
import { SQLiteConversationStore } from "./db/SQLiteConversationStore.js";
import { SQLiteConversationActorStore } from "./db/SQLiteConversationActorStore.js";
import { SQLiteUserProfileStore } from "./db/SQLiteUserProfileStore.js";
import { SQLiteUserPreferencesStore } from "./db/SQLiteUserPreferencesStore.js";
import { SQLiteUserProviderCredentialStore } from "./db/SQLiteUserProviderCredentialStore.js";

/**
 * Create a fully-wired AppStores backed by SQLite.
 *
 * The caller is responsible for opening the database first via `openDatabase()`.
 * All stores share the same db instance so Drizzle can use a single connection.
 */
export function createSqliteStores(options: { db: DrizzleDb }): AppStores {
    const { db } = options;
    const conversationActor = new SQLiteConversationActorStore(db);
    return {
        character: new SQLiteCharacterStore(db),
        userProfile: new SQLiteUserProfileStore(db),
        userPreferences: new SQLiteUserPreferencesStore(db),
        conversation: new SQLiteConversationStore(db),
        conversationActor,
        chat: new SQLiteChatStore(db),
        providerCredential: new SQLiteUserProviderCredentialStore(db),
    };
}
