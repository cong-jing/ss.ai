import fs from "node:fs";
import path from "node:path";
import { AgentConfig, LogLevel } from "../packages/agent/src";

export interface RuntimeConfig {
    http: {
        host: string;
        port: number;
    };
    logger: {
        level: LogLevel;
        filePath: string;
        outputStack: boolean;
    };
    runtimeFiles: {
        tempDir: string;
        userDataDir: string;
    };
    agent: AgentConfig;
}

interface JsonRuntimeConfig {
    http?: {
        host?: unknown;
        port?: unknown;
    };
    logger?: {
        level?: unknown;
        filePath?: unknown;
        stackLevel?: unknown;
        outputStack?: unknown;
    };
    runtimeFiles?: {
        tempDir?: unknown;
        userDataDir?: unknown;
    };
    agent?: {
        model?: unknown;
        timeoutMs?: unknown;
        maxRetries?: unknown;
    };
}

function toNumber(value: unknown, fallback: number): number {
    if (value === undefined || value === null || value === "") {
        return fallback;
    }

    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function toLogLevel(value: unknown): LogLevel {
    const normalized = typeof value === "string" ? value.toLowerCase() : undefined;
    if (normalized === "debug" || normalized === "info" || normalized === "warn" || normalized === "error") {
        return normalized;
    }
    return "info";
}

function toString(value: unknown, fallback: string): string {
    return typeof value === "string" && value.trim() ? value : fallback;
}

function toBoolean(value: unknown, fallback: boolean): boolean {
    if (typeof value === "boolean") {
        return value;
    }

    if (typeof value === "string") {
        if (value.toLowerCase() === "true") {
            return true;
        }

        if (value.toLowerCase() === "false") {
            return false;
        }
    }

    return fallback;
}

function readJsonConfig(configPath: string): JsonRuntimeConfig {
    if (!fs.existsSync(configPath)) {
        return {};
    }

    const raw = fs.readFileSync(configPath, "utf-8");
    const parsed = JSON.parse(raw) as unknown;

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error(`Invalid config format in ${configPath}`);
    }

    return parsed as JsonRuntimeConfig;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === "object" && !Array.isArray(value);
}

function mergeConfig(base: JsonRuntimeConfig, override: JsonRuntimeConfig): JsonRuntimeConfig {
    const result: Record<string, unknown> = { ...base };

    for (const [key, value] of Object.entries(override)) {
        const current = result[key];
        if (isRecord(current) && isRecord(value)) {
            result[key] = mergeConfig(current as JsonRuntimeConfig, value as JsonRuntimeConfig);
            continue;
        }

        result[key] = value;
    }

    return result as JsonRuntimeConfig;
}

function toAbsolutePath(input: unknown, fallbackRelativePath: string): string {
    if (typeof input === "string" && input.trim()) {
        return path.resolve(process.cwd(), input);
    }

    return path.resolve(process.cwd(), fallbackRelativePath);
}

export function loadRuntimeConfig(): RuntimeConfig {
    const defaultConfigPath = path.resolve(process.cwd(), "config.default.json");
    const localConfigPath = path.resolve(process.cwd(), "config.local.json");

    const defaultConfig = readJsonConfig(defaultConfigPath);
    const localConfig = readJsonConfig(localConfigPath);
    const fileConfig = mergeConfig(defaultConfig, localConfig);

    const loggerFilePath = toAbsolutePath(fileConfig.logger?.filePath, "app.log");
    const tempDir = toAbsolutePath(fileConfig.runtimeFiles?.tempDir, ".runtime/temp");
    const userDataDir = toAbsolutePath(fileConfig.runtimeFiles?.userDataDir, ".runtime/user-data");

    return {
        http: {
            host: toString(fileConfig.http?.host, "0.0.0.0"),
            port: toNumber(fileConfig.http?.port, 3000)
        },
        logger: {
            level: toLogLevel(fileConfig.logger?.level),
            filePath: loggerFilePath,
            outputStack: toBoolean(fileConfig.logger?.outputStack, false)
        },
        runtimeFiles: {
            tempDir,
            userDataDir
        },
        agent: {
            model: toString(fileConfig.agent?.model, "gpt-4.1-mini"),
            timeoutMs: toNumber(fileConfig.agent?.timeoutMs, 30000),
            maxRetries: toNumber(fileConfig.agent?.maxRetries, 2)
        }
    };

    // TODO: add schema validation (zod/valibot) and fail-fast behavior.
}
