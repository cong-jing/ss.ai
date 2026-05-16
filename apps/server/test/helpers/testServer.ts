import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import supertest from "supertest";
import { createHttpServer } from "../../src/http/server.js";
import type { RuntimeConfig, RuntimeModelEntry } from "../../src/util/config.js";
import { Logger, setGlobalLogger } from "@ss-ai/persona-flow-logger";
import { InMemoryCharacterStore } from "./inMemoryCharacterStore.js";
import { InMemoryUserProfileStore } from "./inMemoryUserProfileStore.js";
import { InMemoryUserPreferencesStore } from "./inMemoryUserPreferencesStore.js";
import { InMemoryUserProviderCredentialStore } from "./inMemoryUserProviderCredentialStore.js";
import { InMemoryConversationStore } from "./inMemoryConversationStore.js";
import { InMemoryChatStore } from "./inMemoryChatStore.js";
import { InMemoryConversationActorStore } from "./inMemoryConversationActorStore.js";
import type { AppStores } from "@ss-ai/persona-flow";

export interface TestApp {
    /** supertest agent — call `.get()`, `.post()`, `.patch()`, `.delete()` on this. */
    agent: ReturnType<typeof supertest>;
    /** Direct access to in-memory stores for test data setup. */
    stores: AppStores;
    /** Delete the temp data directory. No server to stop — there is none. */
    cleanup: () => void;
}

/**
 * Creates a test Express app backed by an in-memory CharacterStore and a
 * temporary directory for file-based stores (userSettings, userInfo).
 *
 * No real HTTP server is started. supertest drives the Express app in-process,
 * so stack traces are complete and breakpoints work normally inside route handlers.
 *
 * @param models  Optional provider map — inject mock entries for tests that
 *                exercise userSettings routes.
 */
export function createTestApp(models: Record<string, RuntimeModelEntry> = {}): TestApp {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ss-ai-test-"));

    setGlobalLogger(Logger.noop());

    const config: RuntimeConfig = {
        http: { host: "127.0.0.1", port: 0 },
        logger: {
            level: "warn",
            logFilePath: path.join(tmpDir, "test.log"),
            clearLogFileOnStart: false,
            includeSourceLocation: false,
            includeStackTrace: false,
        },
        runtimeFiles: {
            tempDir: path.join(tmpDir, "tmp"),
            userDataDir: tmpDir,
        },
        models,
        agent: { timeoutMs: 30000, maxRetries: 2 },
        promptLog: { enabled: false, filePath: "" },
    };

    const conversationActor = new InMemoryConversationActorStore();
    const stores: AppStores = {
        conversationActor,
        character: new InMemoryCharacterStore(),
        userProfile: new InMemoryUserProfileStore(),
        userPreferences: new InMemoryUserPreferencesStore(),
        conversation: new InMemoryConversationStore(),
        chat: new InMemoryChatStore(),
        providerCredential: new InMemoryUserProviderCredentialStore(),
    };

    const app = createHttpServer(config, { stores }) as typeof createHttpServer extends (...args: any[]) => infer T ? T & { closeDatabase?: () => void } : never;

    return {
        agent: supertest(app),
        stores,
        cleanup: () => {
            app.closeDatabase?.();
            fs.rmSync(tmpDir, { recursive: true, force: true });
        },
    };
}
