import fs from "node:fs";
import path from "node:path";
import util from "node:util";

export type LogLevel = "debug" | "info" | "warn" | "error";

const levelWeight: Record<LogLevel, number> = {
    debug: 10,
    info: 20,
    warn: 30,
    error: 40
};

export interface LoggerOptions {
    level: LogLevel;
    logFilePath: string;
    includeSourceLocation: boolean;
    includeStackTrace: boolean;
    stackLevel: number;
}

export type LoggerOverrideOptions = Partial<LoggerOptions>;

interface CallerInfo {
    functionName: string;
    fileName: string;
    line: number;
}

const noopOptions: LoggerOptions = {
    level: "error",
    logFilePath: "",
    includeSourceLocation: false,
    includeStackTrace: false,
    stackLevel: 0,
};

export class Logger {
    private readonly options: LoggerOptions;
    private readonly logFilePath?: string;
    private readonly enabled: boolean;

    constructor(options: LoggerOptions, enabled = true) {
        this.options = options;
        this.enabled = enabled;

        if (enabled) {
            this.logFilePath = path.resolve(options.logFilePath);
            fs.mkdirSync(path.dirname(this.logFilePath), { recursive: true });
        }
    }

    static noop(): Logger {
        return new Logger(noopOptions, false);
    }

    debug(message: string, meta?: Record<string, unknown>, onceOptions?: LoggerOverrideOptions): void {
        this.log("debug", message, meta, onceOptions);
    }

    info(message: string, meta?: Record<string, unknown>, onceOptions?: LoggerOverrideOptions): void {
        this.log("info", message, meta, onceOptions);
    }

    warn(message: string, meta?: Record<string, unknown>, onceOptions?: LoggerOverrideOptions): void {
        this.log("warn", message, meta, onceOptions);
    }

    error(message: string, meta?: Record<string, unknown>, onceOptions?: LoggerOverrideOptions): void {
        this.log("error", message, meta, onceOptions);
    }

    private log(
        level: LogLevel,
        message: string,
        meta?: Record<string, unknown>,
        onceOptions?: LoggerOverrideOptions
    ): void {
        const options = this.getEffectiveOptions(onceOptions);
        if (!this.enabled || !this.shouldLog(level, options.level)) {
            return;
        }

        const block = this.formatMessage(level, message, meta, options.stackLevel, options.includeSourceLocation, options.includeStackTrace);
        this.writeBlock(block, options.logFilePath);
    }

    private getEffectiveOptions(onceOptions?: LoggerOverrideOptions): LoggerOptions {
        return {
            ...this.options,
            ...onceOptions
        };
    }

    private shouldLog(target: LogLevel, level: LogLevel): boolean {
        return levelWeight[target] >= levelWeight[level];
    }

    private formatMessage(
        logLevel: LogLevel,
        message: string,
        meta: Record<string, unknown> | undefined,
        stackLevel: number,
        includeSourceLocation?: boolean,
        includeStackTrace?: boolean
    ): string {
        const now = new Date().toISOString();
        const caller = this.getCallerInfo(stackLevel);
        const header = `[${now}] [${logLevel.toUpperCase()}]`
            + (includeSourceLocation ? ` ${caller.functionName} (${caller.fileName}:${caller.line})` : "");

        if (meta) {
            const prettyMeta = util.inspect(meta, {
                depth: null,
                colors: false,
                compact: false,
                sorted: true,
                breakLength: 80
            });

            message += ` ${prettyMeta}`;
        }

        const parts: string[] = [header, message];

        if (includeStackTrace) {
            parts.push("Stack:");
            parts.push(this.getPrettyStack(stackLevel));
        }

        return parts.join("\n");
    }

    private writeBlock(block: string, logFilePath?: string): void {
        const targetPath = logFilePath ? path.resolve(logFilePath) : this.logFilePath;
        if (!targetPath) {
            return;
        }

        fs.mkdirSync(path.dirname(targetPath), { recursive: true });
        fs.appendFileSync(targetPath, `${block}\n`, "utf-8");
    }

    private parseStackLine(stackLine: string): CallerInfo | undefined {
        const withFunction = /^\s*at\s+(.*?)\s+\((.*):(\d+):(\d+)\)$/;
        const withoutFunction = /^\s*at\s+(.*):(\d+):(\d+)$/;

        const matchedWithFunction = stackLine.match(withFunction);
        if (matchedWithFunction) {
            const functionName = matchedWithFunction[1] || "anonymous";
            const filePath = matchedWithFunction[2];
            const line = Number(matchedWithFunction[3]);

            const fileName = path.resolve(filePath);
            return {
                functionName,
                fileName,
                line
            };
        }

        const matchedWithoutFunction = stackLine.match(withoutFunction);
        if (matchedWithoutFunction) {
            const filePath = matchedWithoutFunction[1];
            const line = Number(matchedWithoutFunction[2]);

            const fileName = path.resolve(filePath);
            return {
                functionName: "anonymous",
                fileName,
                line
            };
        }

        return undefined;
    }

    private getCallerInfo(stackLevel: number): CallerInfo {
        const stack = new Error().stack;
        if (!stack) {
            return {
                functionName: "unknown",
                fileName: "unknown",
                line: 0
            };
        }

        const stackLines = stack.split("\n").slice(1);
        const parsedFrames: CallerInfo[] = [];

        for (const line of stackLines) {
            if (line.includes("logger.ts") || line.includes("logger.js")) {
                continue;
            }

            const parsed = this.parseStackLine(line);
            if (parsed) {
                parsedFrames.push(parsed);
            }
        }

        if (parsedFrames.length > 0) {
            const idx = Math.min(Math.max(0, stackLevel), parsedFrames.length - 1);
            return parsedFrames[idx];
        }

        return {
            functionName: "unknown",
            fileName: "unknown",
            line: 0
        };
    }

    private getPrettyStack(stackLevel: number): string {
        const stack = new Error().stack;
        if (!stack) {
            return "(stack unavailable)";
        }

        const filtered = stack
            .split("\n")
            .slice(1)
            .filter((line) => !line.includes("logger.ts") && !line.includes("logger.js"));

        const startIndex = Math.min(Math.max(0, stackLevel), filtered.length);
        const stackBody = filtered.slice(startIndex).join("\n");
        return stackBody || "(stack unavailable)";
    }
}

let globalLogger: Logger | undefined = undefined;

export function setGlobalLogger(logger: Logger): void {
    globalLogger = logger;
}

export function getGlobalLogger(): Logger {
    if (!globalLogger) {
        globalLogger = Logger.noop();
    }
    return globalLogger;
}
export function createLogger(options: LoggerOptions): Logger {
    return new Logger(options);
}