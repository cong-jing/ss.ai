import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import supertest from "supertest";
import { createHttpServer } from "../../src/http/server.js";
import type { RuntimeConfig, RuntimeModelEntry } from "../../src/util/config.js";
import { Logger, setGlobalLogger } from "../../src/util/logger.js";
import { InMemoryCharacterStore } from "./inMemoryCharacterStore.js";
import { InMemoryUserProfileStore } from "./inMemoryUserProfileStore.js";
import { InMemoryUserPreferencesStore } from "./inMemoryUserPreferencesStore.js";
import { InMemoryUserProviderCredentialStore } from "./inMemoryUserProviderCredentialStore.js";
import { InMemoryChatStore } from "./inMemoryChatStore.js";
import type { AppStores } from "@ss-ai/persona-flow";

export interface TestApp {
    /** supertest agent — call `.get()`, `.post()`, `.patch()`, `.delete()` on this. */
    agent: ReturnType<typeof supertest>;
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

    const stores: AppStores = {
        character: new InMemoryCharacterStore(),
        userProfile: new InMemoryUserProfileStore(),
        userPreferences: new InMemoryUserPreferencesStore(),
        chat: new InMemoryChatStore(),
        providerCredential: new InMemoryUserProviderCredentialStore(),
    };

    const app = createHttpServer(config, { stores });

    return {
        agent: supertest(app),
        cleanup: () => fs.rmSync(tmpDir, { recursive: true, force: true }),
    };
}
