import { mkdirSync } from "fs";
import { dirname } from "path";
import pino, { type LevelWithSilent, type Logger } from "pino";

let logFilePath = "./.runtime/qq-bot/qq-bot.log";
let logger = createConsoleLogger();

function createConsoleLogger(): Logger {
    return pino(
        {
            base: undefined,
            timestamp: pino.stdTimeFunctions.isoTime,
            level: process.env.LOG_LEVEL?.trim().toLowerCase() || "info",
        },
        pino.destination({ dest: 1, sync: true }),
    );
}

function createLogger(path: string): Logger {
    mkdirSync(dirname(path), { recursive: true });
    return pino(
        {
            base: undefined,
            timestamp: pino.stdTimeFunctions.isoTime,
            level: process.env.LOG_LEVEL?.trim().toLowerCase() || "info",
        },
        pino.multistream([
            { stream: pino.destination({ dest: 1, sync: true }) },
            { stream: pino.destination({ dest: path, sync: false }) },
        ]),
    );
}

export function configureLogger(path: string): void {
    logFilePath = path;
    logger = createLogger(logFilePath);
}

function write(level: LevelWithSilent, args: unknown[]): void {
    if (args.length === 0) {
        logger[level]("");
        return;
    }

    const [first, ...rest] = args;
    if (typeof first === "string") {
        if (rest.length === 1 && typeof rest[0] === "object" && rest[0] !== null) {
            logger[level](rest[0] as object, first);
            return;
        }

        if (rest.length > 0) {
            logger[level]({ extra: rest }, first);
            return;
        }

        logger[level](first);
        return;
    }

    if (typeof first === "object" && first !== null) {
        logger[level](first as object);
        return;
    }

    logger[level](String(first));
}

export function log(...args: unknown[]): void {
    write("info", args);
}

export function logInfo(...args: unknown[]): void {
    write("info", args);
}

export function logWarn(...args: unknown[]): void {
    write("warn", args);
}

export function logError(...args: unknown[]): void {
    write("error", args);
}
