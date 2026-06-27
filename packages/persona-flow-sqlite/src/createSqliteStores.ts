import type { AppStores, MemoryClock, MemoryIdGenerator, MemoryLogger } from "@ss-ai/persona-flow";
import type { DrizzleDb } from "./db/openDatabase.js";
import { SQLiteChatStore } from "./db/SQLiteChatStore.js";
import { SQLiteCharacterStore } from "./db/SQLiteCharacterStore.js";
import { SQLiteConversationStore } from "./db/SQLiteConversationStore.js";
import { SQLiteConversationActorStore } from "./db/SQLiteConversationActorStore.js";
import { SQLiteUserProfileStore } from "./db/SQLiteUserProfileStore.js";
import { SQLiteUserPreferencesStore } from "./db/SQLiteUserPreferencesStore.js";
import { SQLiteUserProviderCredentialStore } from "./db/SQLiteUserProviderCredentialStore.js";
import { SQLiteMemoryCandidateStore } from "./db/SQLiteMemoryCandidateStore.js";
import { SQLiteMemoryStore } from "./db/SQLiteMemoryStore.js";
import { SQLiteMemoryDecisionStore } from "./db/SQLiteMemoryDecisionStore.js";
import { CharacterDbRouter } from "./db/CharacterDbRouter.js";
import type { DbLog } from "./db/openDatabase.js";

/**
 * Create a fully-wired AppStores backed by SQLite.
 *
 * The caller is responsible for opening the database first via `openDatabase()`.
 * All stores share the same db instance so Drizzle can use a single connection.
 *
 * Memory tables live in the core DB even when a `characterDbDir` is
 * supplied. Every memory is bound to one character world, but
 * keeping all three memory tables in one place lets the
 * brute-force similarity scan run a single query per
 * `(user, character, scope, type)` bucket and avoids per-character
 * DB plumbing for the memory subsystem. Sharding by character is a
 * Step 7+ optimization tracked in `docs/todo.md` rather than a
 * Batch 2/3 requirement.
 */
export function createSqliteStores(options: {
    db: DrizzleDb;
    characterDbDir?: string;
    dblog?: DbLog;
    /** Override the wall clock — useful for tests. Defaults to `new Date().toISOString()`. */
    memoryClock?: MemoryClock;
    /** Override id generation — useful for tests. Defaults to `crypto.randomUUID()`. */
    memoryIds?: MemoryIdGenerator;
    /** Optional structured logger forwarded to the memory stores. */
    memoryLogger?: MemoryLogger;
}): AppStores & { close?: () => void } {
    const { db, characterDbDir, dblog } = options;
    const characterDbRouter = characterDbDir ? new CharacterDbRouter(db, characterDbDir, dblog) : undefined;
    const conversationActor = new SQLiteConversationActorStore(db, characterDbRouter);

    const memoryClock: MemoryClock = options.memoryClock ?? {
        nowIso: () => new Date().toISOString(),
    };
    const memoryIds: MemoryIdGenerator = options.memoryIds ?? {
        randomId: () => crypto.randomUUID(),
    };
    const memoryLogger = options.memoryLogger;

    const stores: AppStores & { close?: () => void } = {
        character: new SQLiteCharacterStore(db),
        userProfile: new SQLiteUserProfileStore(db),
        userPreferences: new SQLiteUserPreferencesStore(db),
        conversation: new SQLiteConversationStore(db, characterDbRouter),
        conversationActor,
        chat: new SQLiteChatStore(db, characterDbRouter),
        providerCredential: new SQLiteUserProviderCredentialStore(db),
        memoryCandidate: new SQLiteMemoryCandidateStore({
            db,
            clock: memoryClock,
            ids: memoryIds,
            logger: memoryLogger,
        }),
        memory: new SQLiteMemoryStore({
            db,
            ids: memoryIds,
            logger: memoryLogger,
        }),
        memoryDecision: new SQLiteMemoryDecisionStore({
            db,
            ids: memoryIds,
            logger: memoryLogger,
        }),
    };
    if (characterDbRouter) {
        stores.close = () => {
            characterDbRouter.closeAll();
        };
    }
    return stores;
}
