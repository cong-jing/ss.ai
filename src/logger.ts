import fs from "node:fs";
import path from "node:path";
import util from "node:util";
import { Logger, LogLevel } from "../packages/agent/src";

const levelWeight: Record<LogLevel, number> = {
    debug: 10,
    info: 20,
    warn: 30,
    error: 40
};

export interface LoggerOptions {
    level: LogLevel;
    filePath: string;
    stackLevel: number;
    outputStack: boolean;
}

interface CallerInfo {
    functionName: string;
    fileName: string;
    line: number;
}

function parseStackLine(stackLine: string): CallerInfo | undefined {
    const withFunction = /^\s*at\s+(.*?)\s+\((.*):(\d+):(\d+)\)$/;
    const withoutFunction = /^\s*at\s+(.*):(\d+):(\d+)$/;

    const matchedWithFunction = stackLine.match(withFunction);
    if (matchedWithFunction) {
        const functionName = matchedWithFunction[1] || "anonymous";
        const filePath = matchedWithFunction[2];
        const line = Number(matchedWithFunction[3]);

        const fileName = path.relative(process.cwd(), filePath) || filePath;
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

        const fileName = path.relative(process.cwd(), filePath) || filePath;
        return {
            functionName: "anonymous",
            fileName,
            line
        };
    }

    return undefined;
}

function getCallerInfo(stackLevel: number): CallerInfo {
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

        const parsed = parseStackLine(line);
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

function getPrettyStack(stackLevel: number): string {
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

export function createLogger(options: LoggerOptions): Logger {
    const logFilePath = path.resolve(options.filePath);
    fs.mkdirSync(path.dirname(logFilePath), { recursive: true });

    function shouldLog(target: LogLevel): boolean {
        return levelWeight[target] >= levelWeight[options.level];
    }

    function formatMessage(logLevel: LogLevel, message: string, meta?: Record<string, unknown>): string {
        const now = new Date().toISOString();
        const caller = getCallerInfo(options.stackLevel);
        const header = `[${now}] [${logLevel.toUpperCase()}] ${caller.functionName} (${caller.fileName}:${caller.line})`;

        const parts: string[] = [header, message];

        if (meta) {
            const prettyMeta = util.inspect(meta, {
                depth: null,
                colors: false,
                compact: false,
                sorted: true,
                breakLength: 80
            });

            parts.push(prettyMeta);
        }

        if (options.outputStack) {
            parts.push("Stack:");
            parts.push(getPrettyStack(options.stackLevel));
        }

        return parts.join("\n");
    }

    function writeBlock(block: string): void {
        fs.appendFileSync(logFilePath, `${block}\n`, "utf-8");
    }

    return {
        debug(message, meta) {
            if (shouldLog("debug")) {
                const block = formatMessage("debug", message, meta);
                console.debug(block);
                writeBlock(block);
            }
        },
        info(message, meta) {
            if (shouldLog("info")) {
                const block = formatMessage("info", message, meta);
                console.info(block);
                writeBlock(block);
            }
        },
        warn(message, meta) {
            if (shouldLog("warn")) {
                const block = formatMessage("warn", message, meta);
                console.warn(block);
                writeBlock(block);
            }
        },
        error(message, meta) {
            if (shouldLog("error")) {
                const block = formatMessage("error", message, meta);
                console.error(block);
                writeBlock(block);
            }
        }
    };
}
