import fs from "node:fs";
import path from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import type { ErrorObject, ValidateFunction } from "ajv";
import type { LogLevel } from "@ss-ai/persona-flow-logger";

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
    promptLog: {
        enabled: boolean;
        filePath: string;
    };
    auth: {
        mode: "default-user" | "local-password";
        defaultUserId: string;
        allowRegistration: boolean;
        sessionDays: number;
        cookieName: string;
        cookieSecure: boolean;
    };
}

interface RuntimeConfigContext {
    appHome?: string;
    appEnv?: string;
    cwd?: string;
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
    promptLog?: {
        enabled?: boolean;
        filePath?: string;
    };
    auth?: {
        mode?: "default-user" | "local-password";
        defaultUserId?: string;
        allowRegistration?: boolean;
        sessionDays?: number;
        cookieName?: string;
        cookieSecure?: boolean;
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

function resolveAppHome(context: RuntimeConfigContext = {}): string {
    const configuredAppHome = context.appHome ?? process.env["APP_HOME"]?.trim();
    if (!configuredAppHome) {
        return context.cwd ?? process.cwd();
    }

    return path.resolve(context.cwd ?? process.cwd(), configuredAppHome);
}

function resolveAppEnv(context: RuntimeConfigContext = {}): string | undefined {
    const raw = context.appEnv ?? process.env["APP_ENV"]?.trim();
    return raw ? raw : undefined;
}

function createSchemaValidator(appHome: string): ValidateFunction | null {
    const configSchemaPath = path.join(appHome, "schemas", "config.schema.json");
    if (!fs.existsSync(configSchemaPath)) {
        return null;
    }

    const configSchemaRaw = fs.readFileSync(configSchemaPath, "utf-8");
    const configSchema = JSON.parse(configSchemaRaw) as object;
    const ajv = new Ajv2020({ allErrors: true, strict: false, coerceTypes: true });
    return ajv.compile(configSchema);
}

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

function validateRawConfig(
    parsed: unknown,
    configPath: string,
    validateConfigWithSchema: ValidateFunction | null,
): RawConfig {
    if (!validateConfigWithSchema) {
        return parsed as RawConfig;
    }

    const isValid = validateConfigWithSchema(parsed);
    if (!isValid) {
        throw new Error(`Config validation failed (${configPath}): ${formatSchemaIssues(validateConfigWithSchema.errors)}`);
    }

    return parsed as RawConfig;
}

function readJsonConfig(configPath: string): { config: RawConfig; exists: boolean } {
    if (!fs.existsSync(configPath)) {
        return {
            config: {},
            exists: false,
        };
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

    return {
        config: parsed as RawConfig,
        exists: true,
    };
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

function toAbsolutePath(appHome: string, input: unknown, fallbackRelativePath: string): string {
    if (typeof input === "string" && input.trim()) {
        return path.resolve(appHome, input);
    }

    return path.resolve(appHome, fallbackRelativePath);
}

export function loadRuntimeConfig(context: RuntimeConfigContext = {}): RuntimeConfig {
    const appHome = resolveAppHome(context);
    const appEnv = resolveAppEnv(context);
    const configDir = path.join(appHome, "config");
    const validateConfigWithSchema = createSchemaValidator(appHome);
    const defaultConfigPath = path.join(configDir, "config.default.json");
    const envConfigPath = appEnv ? path.join(configDir, `config.${appEnv}.json`) : undefined;
    const localConfigPath = path.join(configDir, "config.local.json");

    const defaultConfig = readJsonConfig(defaultConfigPath);
    const envConfig = envConfigPath
        ? readJsonConfig(envConfigPath)
        : {
            config: {},
            exists: false,
        };
    const localConfig = readJsonConfig(localConfigPath);

    let mergedConfig = mergeConfig(defaultConfig.config, envConfig.config);
    mergedConfig = mergeConfig(mergedConfig, localConfig.config);

    const configSources = [defaultConfigPath];
    if (envConfig.exists && envConfigPath) {
        configSources.push(envConfigPath);
    }
    if (localConfig.exists) {
        configSources.push(localConfigPath);
    }

    const fileConfig = validateRawConfig(mergedConfig, configSources.join(" + "), validateConfigWithSchema);
    const models = buildRuntimeModels(fileConfig.models);

    const loggerFilePath = toAbsolutePath(appHome, fileConfig.logger?.logFilePath, "app.log");
    const tempDir = toAbsolutePath(appHome, fileConfig.runtimeFiles?.tempDir, ".runtime/temp");
    const userDataDir = toAbsolutePath(appHome, fileConfig.runtimeFiles?.userDataDir, ".runtime/user-data");
    const promptLogFilePath = toAbsolutePath(appHome, fileConfig.promptLog?.filePath, ".runtime/logs/prompt.log");
    const authMode = fileConfig.auth?.mode ?? "default-user";
    const defaultUserId = normalizeOptionalString(fileConfig.auth?.defaultUserId) ?? "default";
    const cookieName = normalizeOptionalString(fileConfig.auth?.cookieName) ?? "ss_ai_session";
    const sessionDaysRaw = fileConfig.auth?.sessionDays;
    const sessionDays = Number.isFinite(sessionDaysRaw)
        ? Math.max(1, Math.floor(sessionDaysRaw as number))
        : 30;
    const cookieSecure = fileConfig.auth?.cookieSecure ?? false;

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
        },
        promptLog: {
            enabled: fileConfig.promptLog?.enabled ?? false,
            filePath: promptLogFilePath,
        },
        auth: {
            mode: authMode,
            defaultUserId,
            allowRegistration: fileConfig.auth?.allowRegistration ?? true,
            sessionDays,
            cookieName,
            cookieSecure,
        },
    };
}
