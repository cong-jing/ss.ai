import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadRuntimeConfig } from "../src/util/config.js";

const tempDirs = new Set<string>();

after(async () => {
    await Promise.all(Array.from(tempDirs, dir => rm(dir, { recursive: true, force: true })));
    tempDirs.clear();
});

async function createTempDir(prefix: string): Promise<string> {
    const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
    tempDirs.add(dir);
    return dir;
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, `${JSON.stringify(value, null, 4)}\n`, "utf-8");
}

function createBaseConfig() {
    return {
        http: {
            host: "127.0.0.1",
            port: 8999,
        },
        logger: {
            level: "info",
            logFilePath: ".runtime/logs/ss-ai.log",
            clearLogFileOnStart: false,
            includeSourceLocation: true,
            includeStackTrace: false,
        },
        runtimeFiles: {
            tempDir: ".runtime/temp",
            userDataDir: ".runtime/user-data",
        },
        agent: {
            timeoutMs: 30000,
            maxRetries: 2,
        },
        promptLog: {
            enabled: true,
            filePath: ".runtime/logs/ss-ai.prompt.log",
        },
        models: {
            "mistral.ai": {
                apiUrl: "https://api.mistral.ai",
                availableModels: ["mistral-large-latest"],
            },
        },
    };
}

function configPath(appHome: string, fileName: string): string {
    return path.join(appHome, "config", fileName);
}

describe("loadRuntimeConfig", () => {
    it("uses cwd as the default app home and resolves relative runtime paths from it", async () => {
        const appHome = await createTempDir("ss-ai-config-cwd-");
        await writeJson(configPath(appHome, "config.default.json"), {
            ...createBaseConfig(),
            runtimeFiles: {
                tempDir: ".runtime/temp-dev",
                userDataDir: ".runtime/user-data-dev",
            },
            promptLog: {
                enabled: true,
                filePath: ".runtime/logs/dev.prompt.log",
            },
        });

        const config = loadRuntimeConfig({ cwd: appHome });

        assert.equal(config.http.port, 8999);
        assert.equal(config.runtimeFiles.tempDir, path.join(appHome, ".runtime/temp-dev"));
        assert.equal(config.runtimeFiles.userDataDir, path.join(appHome, ".runtime/user-data-dev"));
        assert.equal(config.promptLog.filePath, path.join(appHome, ".runtime/logs/dev.prompt.log"));
    });

    it("merges default, env, and local config in order while resolving relative APP_HOME from cwd", async () => {
        const cwd = await createTempDir("ss-ai-config-parent-");
        const appHome = path.join(cwd, "runtime-root");

        await writeJson(configPath(appHome, "config.default.json"), createBaseConfig());
        await writeJson(configPath(appHome, "config.staging.json"), {
            http: {
                host: "0.0.0.0",
                port: 9100,
            },
            logger: {
                level: "warn",
            },
            runtimeFiles: {
                tempDir: ".runtime/temp-staging",
            },
            promptLog: {
                enabled: false,
            },
        });
        await writeJson(configPath(appHome, "config.local.json"), {
            http: {
                port: 9200,
            },
            logger: {
                level: "debug",
            },
            runtimeFiles: {
                userDataDir: ".runtime/user-data-local",
            },
        });

        const config = loadRuntimeConfig({
            cwd,
            appHome: "./runtime-root",
            appEnv: "staging",
        });

        assert.equal(config.http.host, "0.0.0.0");
        assert.equal(config.http.port, 9200);
        assert.equal(config.logger.level, "debug");
        assert.equal(config.promptLog.enabled, false);
        assert.equal(config.runtimeFiles.tempDir, path.join(appHome, ".runtime/temp-staging"));
        assert.equal(config.runtimeFiles.userDataDir, path.join(appHome, ".runtime/user-data-local"));
    });

    it("treats missing env-specific config as optional", async () => {
        const appHome = await createTempDir("ss-ai-config-optional-env-");
        await writeJson(configPath(appHome, "config.default.json"), {
            ...createBaseConfig(),
            http: {
                host: "127.0.0.1",
                port: 9300,
            },
        });

        const config = loadRuntimeConfig({
            cwd: appHome,
            appEnv: "prod",
        });

        assert.equal(config.http.port, 9300);
        assert.equal(config.logger.logFilePath, path.join(appHome, ".runtime/logs/ss-ai.log"));
    });
});