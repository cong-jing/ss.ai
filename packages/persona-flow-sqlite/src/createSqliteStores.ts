import type { AppStores } from "@ss-ai/persona-flow";
import type { DrizzleDb } from "./db/openDatabase.js";
import { SQLiteChatStore } from "./db/SQLiteChatStore.js";
import { SQLiteCharacterStore } from "./db/SQLiteCharacterStore.js";
import { SQLiteConversationStore } from "./db/SQLiteConversationStore.js";
import { SQLiteConversationActorStore } from "./db/SQLiteConversationActorStore.js";
import { SQLiteUserProfileStore } from "./db/SQLiteUserProfileStore.js";
import { SQLiteUserPreferencesStore } from "./db/SQLiteUserPreferencesStore.js";
import { SQLiteUserProviderCredentialStore } from "./db/SQLiteUserProviderCredentialStore.js";
import { CharacterDbRouter } from "./db/CharacterDbRouter.js";
import type { DbLog } from "./db/openDatabase.js";

/**
 * Create a fully-wired AppStores backed by SQLite.
 *
 * The caller is responsible for opening the database first via `openDatabase()`.
 * All stores share the same db instance so Drizzle can use a single connection.
 */
export function createSqliteStores(options: {
    db: DrizzleDb;
    characterDbDir?: string;
    dblog?: DbLog;
}): AppStores {
    const { db, characterDbDir, dblog } = options;
    const characterDbRouter = characterDbDir ? new CharacterDbRouter(db, characterDbDir, dblog) : undefined;
    const conversationActor = new SQLiteConversationActorStore(db, characterDbRouter);
    const stores: AppStores & { close?: () => void } = {
        character: new SQLiteCharacterStore(db),
        userProfile: new SQLiteUserProfileStore(db),
        userPreferences: new SQLiteUserPreferencesStore(db),
        conversation: new SQLiteConversationStore(db, characterDbRouter),
        conversationActor,
        chat: new SQLiteChatStore(db, characterDbRouter),
        providerCredential: new SQLiteUserProviderCredentialStore(db),
    };
    if (characterDbRouter) {
        stores.close = () => {
            characterDbRouter.closeAll();
        };
    }
    return stores;
}
