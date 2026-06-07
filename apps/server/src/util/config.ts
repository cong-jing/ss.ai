import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Ajv2020 } from "ajv/dist/2020.js";
import type { ErrorObject, ValidateFunction } from "ajv";
import type { LogLevel } from "@ss-ai/persona-flow-logger";
import type { ModelAssignmentMap } from "@ss-ai/contracts";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(moduleDir, "..", "..");

export interface RuntimeModelEntry {
    provider: string;
    apiUrl: string;
    apiKey: string;
    defaultModel: string;
    availableModels: string[];
}

export interface RuntimeConfig {
    configSources: string[];
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
    defaultModelAssignments: ModelAssignmentMap;
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

// Loader overrides used by tests and special startup paths.
// - `runtimeHome`: base directory for relative runtime outputs such as logs,
//   temp files, sqlite data, and prompt logs.
// - `appEnv`: selects `config.{appEnv}.json` as an optional overlay. (staging, production, etc.)
// - `cwd`: resolution base for relative `runtimeHome` / `configDir`; defaults
//   to the real process working directory when omitted.
// - `configDir`: explicit config directory override, mainly for tests.
interface RuntimeConfigContext {
    runtimeHome?: string;
    appEnv?: string;
    cwd?: string;
    configDir?: string;
}

interface RawModelConfig {
    provider?: string;
    apiUrl: string;
    apiKey?: string;
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
    defaultModelAssignments?: ModelAssignmentMap;
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
            apiKey: normalizeOptionalString(modelValue.apiKey) ?? "",
            defaultModel: normalizeOptionalString(modelValue.model) ?? "",
            availableModels: resolveAvailableModels(modelValue)
        };
    }

    return runtimeModels;
}

// Runtime files and sqlite data follow the runtime home. In normal development
// this is the repo root because `pnpm run dev:*` starts there. In deployed
// layouts it becomes `.deploy-*/server` because the start command runs there.
function resolveRuntimeHome(context: RuntimeConfigContext = {}): string {
    const configuredRuntimeHome = context.runtimeHome
        ?? process.env["RUNTIME_HOME"]?.trim();
    if (!configuredRuntimeHome) {
        return context.cwd ?? process.cwd();
    }

    return path.resolve(context.cwd ?? process.cwd(), configuredRuntimeHome);
}

// Config files are intentionally *not* resolved from runtimeHome. Source mode
// always reads the committed server config directory unless tests override it.
function resolveConfigDir(context: RuntimeConfigContext = {}): string {
    if (context.configDir?.trim()) {
        return path.resolve(context.cwd ?? process.cwd(), context.configDir);
    }

    return path.join(serverRoot, "config");
}

function resolveAppEnv(context: RuntimeConfigContext = {}): string | undefined {
    const raw = context.appEnv ?? process.env["APP_ENV"]?.trim();
    return raw ? raw : undefined;
}

function createSchemaValidator(): ValidateFunction | null {
    const configSchemaPath = path.join(serverRoot, "schemas", "config.schema.json");

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

function readJsonConfig(
    configPath: string,
    options: { required?: boolean } = {},
): { config: RawConfig; exists: boolean } {
    const required = options.required ?? false;
    if (!fs.existsSync(configPath)) {
        if (required) {
            throw new Error(`Missing required config file: ${configPath}. Check server config assets and deployment config files.`);
        }
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

// Relative paths inside JSON config are expanded from runtimeHome so the same
// config file can be reused in repo-root dev mode and deployed server mode.
function toAbsolutePath(runtimeHome: string, input: unknown, fallbackRelativePath: string): string {
    if (typeof input === "string" && input.trim()) {
        return path.resolve(runtimeHome, input);
    }

    return path.resolve(runtimeHome, fallbackRelativePath);
}

export function loadRuntimeConfig(context: RuntimeConfigContext = {}): RuntimeConfig {
    const runtimeHome = resolveRuntimeHome(context);
    const appEnv = resolveAppEnv(context);
    const configDir = resolveConfigDir(context);
    const validateConfigWithSchema = createSchemaValidator();
    const defaultConfigPath = path.join(configDir, "config.default.json");
    const envConfigPath = appEnv ? path.join(configDir, `config.${appEnv}.json`) : undefined;
    const localConfigPath = path.join(configDir, "config.local.json");

    // Required base config + optional env/local overlays. The merge order is
    // default < env < local, matching the intended override precedence.
    const defaultConfig = readJsonConfig(defaultConfigPath, { required: true });
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

    const loggerFilePath = toAbsolutePath(runtimeHome, fileConfig.logger?.logFilePath, "app.log");
    const tempDir = toAbsolutePath(runtimeHome, fileConfig.runtimeFiles?.tempDir, ".runtime/temp");
    const userDataDir = toAbsolutePath(runtimeHome, fileConfig.runtimeFiles?.userDataDir, ".runtime/user-data");
    const promptLogFilePath = toAbsolutePath(runtimeHome, fileConfig.promptLog?.filePath, ".runtime/logs/prompt.log");
    const authMode = fileConfig.auth?.mode ?? "default-user";
    const defaultUserId = normalizeOptionalString(fileConfig.auth?.defaultUserId) ?? "default";
    const cookieName = normalizeOptionalString(fileConfig.auth?.cookieName) ?? "ss_ai_session";
    const sessionDaysRaw = fileConfig.auth?.sessionDays;
    const sessionDays = Number.isFinite(sessionDaysRaw)
        ? Math.max(1, Math.floor(sessionDaysRaw as number))
        : 30;
    const cookieSecure = fileConfig.auth?.cookieSecure ?? false;

    return {
        configSources,
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
        defaultModelAssignments: fileConfig.defaultModelAssignments ?? {},
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
