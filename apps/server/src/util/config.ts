import fs from "node:fs";
import path from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import type { ErrorObject } from "ajv";
import { LogLevel } from "./logger.js";

export interface RuntimeModelEntry {
    provider: string;
    apiUrl: string;
    defaultModel: string;
    availableModels: string[];
}

export interface RuntimeConfig {
    http: {
        host: string;
        port: number;
    };
    logger: {
        level: LogLevel;
        logFilePath: string;
        clearLogFileOnStart: boolean;
        includeSourceLocation: boolean;
        includeStackTrace: boolean;
    };
    runtimeFiles: {
        tempDir: string;
        userDataDir: string;
    };
    models: Record<string, RuntimeModelEntry>;
    agent: {
        timeoutMs: number;
        maxRetries: number;
    };
}

interface RawModelConfig {
    provider?: string;
    apiUrl: string;
    model?: string;
    availableModels?: string[];
}

interface RawConfig {
    $schema?: string;
    http?: {
        host?: string;
        port?: number;
    };
    logger?: {
        level?: LogLevel;
        logFilePath?: string;
        clearLogFileOnStart?: boolean;
        includeSourceLocation?: boolean;
        includeStackTrace?: boolean;
    };
    models?: Record<string, RawModelConfig>;
    runtimeFiles?: {
        tempDir?: string;
        userDataDir?: string;
    };
    agent?: {
        timeoutMs?: number;
        maxRetries?: number;
    };
}

function parseOptionalModelList(value: string[] | undefined): string[] {
    if (value === undefined) {
        return [];
    }

    const list = value
        .map((item) => item.trim())
        .filter((item) => item.length > 0);

    return Array.from(new Set(list));
}

function normalizeOptionalString(value: string | undefined): string | undefined {
    if (typeof value !== "string") {
        return undefined;
    }

    const normalized = value.trim();
    return normalized.length > 0 ? normalized : undefined;
}

function resolveAvailableModels(model: RawModelConfig): string[] {
    return parseOptionalModelList(model.availableModels);
}

function buildRuntimeModels(modelsRaw: RawConfig["models"]): Record<string, RuntimeModelEntry> {
    if (!modelsRaw || Object.keys(modelsRaw).length === 0) {
        throw new Error("Config error: models must be an object and cannot be empty.");
    }

    const runtimeModels: Record<string, RuntimeModelEntry> = {};

    for (const [modelName, modelValue] of Object.entries(modelsRaw)) {
        const provider = (normalizeOptionalString(modelValue.provider) ?? normalizeOptionalString(modelName) ?? "").toLowerCase();
        if (!provider) {
            throw new Error(`Config error: models.${modelName}.provider is required.`);
        }

        const apiUrl = normalizeOptionalString(modelValue.apiUrl);
        if (!apiUrl) {
            throw new Error(`Config error: models.${modelName}.apiUrl is required.`);
        }

        runtimeModels[modelName] = {
            provider,
            apiUrl,
            defaultModel: normalizeOptionalString(modelValue.model) ?? "",
            availableModels: resolveAvailableModels(modelValue)
        };
    }

    return runtimeModels;
}

const projectRoot = path.resolve(process.cwd(), process.env["APP_ROOT"] ?? ".");
const configSchemaPath = path.join(projectRoot, "schemas", "config.schema.json");
const configSchemaRaw = fs.readFileSync(configSchemaPath, "utf-8");
const configSchema = JSON.parse(configSchemaRaw) as object;
const ajv = new Ajv2020({ allErrors: true, strict: false, coerceTypes: true });
const validateConfigWithSchema = ajv.compile(configSchema);

function formatSchemaIssues(errors: ErrorObject[] | null | undefined): string {
    if (!errors || errors.length === 0) {
        return "unknown schema error";
    }

    const details = errors
        .slice(0, 3)
        .map((issue) => {
            const pathText = issue.instancePath && issue.instancePath !== ""
                ? issue.instancePath
                : "/";
            return `${pathText} ${issue.message ?? "invalid"}`;
        })
        .join(" | ");

    if (errors.length <= 3) {
        return details;
    }

    return `${details} | +${errors.length - 3} more`;
}

function validateRawConfig(parsed: unknown, configPath: string): RawConfig {
    const isValid = validateConfigWithSchema(parsed);
    if (!isValid) {
        throw new Error(`Config validation failed (${configPath}): ${formatSchemaIssues(validateConfigWithSchema.errors)}`);
    }

    return parsed as RawConfig;
}

function readJsonConfig(configPath: string): RawConfig {
    if (!fs.existsSync(configPath)) {
        return {};
    }

    const raw = fs.readFileSync(configPath, "utf-8");
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch (error) {
        throw new Error(`Invalid JSON in ${configPath}: ${(error as Error).message}`);
    }

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error(`Invalid config format in ${configPath}: root must be an object`);
    }

    return parsed as RawConfig;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === "object" && !Array.isArray(value);
}

function mergeConfig(base: RawConfig, override: RawConfig): RawConfig {
    const result: Record<string, unknown> = { ...base };

    for (const [key, value] of Object.entries(override)) {
        const current = result[key];
        if (isRecord(current) && isRecord(value)) {
            result[key] = mergeConfig(current as RawConfig, value as RawConfig);
            continue;
        }

        result[key] = value;
    }

    return result as RawConfig;
}

function toAbsolutePath(input: unknown, fallbackRelativePath: string): string {
    if (typeof input === "string" && input.trim()) {
        return path.resolve(projectRoot, input);
    }

    return path.resolve(projectRoot, fallbackRelativePath);
}

export function loadRuntimeConfig(): RuntimeConfig {
    const defaultConfigPath = path.join(projectRoot, "config.default.json");
    const localConfigPath = path.join(projectRoot, "config.local.json");

    const defaultConfig = readJsonConfig(defaultConfigPath);
    const localConfig = readJsonConfig(localConfigPath);
    const mergedConfig = mergeConfig(defaultConfig, localConfig);
    const fileConfig = validateRawConfig(mergedConfig, `${defaultConfigPath} + ${localConfigPath}`);
    const models = buildRuntimeModels(fileConfig.models);

    const loggerFilePath = toAbsolutePath(fileConfig.logger?.logFilePath, "app.log");
    const tempDir = toAbsolutePath(fileConfig.runtimeFiles?.tempDir, ".runtime/temp");
    const userDataDir = toAbsolutePath(fileConfig.runtimeFiles?.userDataDir, ".runtime/user-data");

    return {
        http: {
            host: fileConfig.http?.host ?? "0.0.0.0",
            port: fileConfig.http?.port ?? 3000
        },
        logger: {
            level: fileConfig.logger?.level ?? "info",
            logFilePath: loggerFilePath,
            clearLogFileOnStart: fileConfig.logger?.clearLogFileOnStart ?? false,
            includeSourceLocation: fileConfig.logger?.includeSourceLocation ?? false,
            includeStackTrace: fileConfig.logger?.includeStackTrace ?? false
        },
        runtimeFiles: {
            tempDir,
            userDataDir
        },
        models,
        agent: {
            timeoutMs: fileConfig.agent?.timeoutMs ?? 30000,
            maxRetries: fileConfig.agent?.maxRetries ?? 2
        }
    };
}