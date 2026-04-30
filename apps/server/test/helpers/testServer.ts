import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHttpServer } from "../../src/http/server.js";
import type { RuntimeConfig } from "../../src/util/config.js";
import { Logger, setGlobalLogger } from "../../src/util/logger.js";
import { InMemoryCharacterStore } from "./inMemoryCharacterStore.js";

export interface TestServer {
    /** Base URL, e.g. "http://127.0.0.1:58123" */
    base: string;
    /** Stop the server and delete the temporary data directory. */
    cleanup: () => void;
}

/**
 * Start a real HTTP server on a random port backed by a temporary data directory.
 * Call `cleanup()` in an `after()` hook to shut it down and remove test data.
 */
export async function startTestServer(): Promise<TestServer> {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ss-ai-test-"));

    // Suppress all log output during tests
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
        models: {},
        agent: { timeoutMs: 30000, maxRetries: 2 },
    };

    const app = createHttpServer(config, { characterStore: new InMemoryCharacterStore() });

    const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
        const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });

    const { port } = server.address() as { port: number };
    const base = `http://127.0.0.1:${port}`;

    return {
        base,
        cleanup: () => {
            server.close();
            fs.rmSync(tmpDir, { recursive: true, force: true });
        },
    };
}
