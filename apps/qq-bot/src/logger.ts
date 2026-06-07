import fs from "node:fs";
import path from "node:path";

let logFilePath = path.resolve(".runtime/qq-bot/qq-bot.log");

export function configureLogger(filePath: string): void {
    logFilePath = path.resolve(filePath);
    fs.mkdirSync(path.dirname(logFilePath), { recursive: true });
    fs.writeFileSync(logFilePath, "", "utf-8");
}

export function log(message: string, meta?: unknown): void {
    const line = meta === undefined
        ? message
        : `${message} ${typeof meta === "string" ? meta : JSON.stringify(meta)}`;
    fs.mkdirSync(path.dirname(logFilePath), { recursive: true });
    fs.appendFileSync(logFilePath, `${line}\n`, "utf-8");
}
