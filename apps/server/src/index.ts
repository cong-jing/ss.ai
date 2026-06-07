import fs from "node:fs";
import { loadRuntimeConfig } from "./util/config.js";
import { startHttpServer } from "./http/server.js";
import { createLogger, setGlobalLogger } from "@ss-ai/persona-flow-logger";

const LOGGER_STACK_LEVEL = 0;

async function main(): Promise<void> {
    const config = loadRuntimeConfig();

    fs.mkdirSync(config.runtimeFiles.tempDir, { recursive: true });
    fs.mkdirSync(config.runtimeFiles.userDataDir, { recursive: true });

    const logger = createLogger({
        // level: config.logger.level,
        // logFilePath: config.logger.logFilePath,
        // clearLogFileOnStart: config.logger.clearLogFileOnStart,
        // includeSourceLocation: config.logger.includeSourceLocation,
        // includeStackTrace: config.logger.includeStackTrace,
        ...config.logger,
        stackLevel: LOGGER_STACK_LEVEL,
    });
    setGlobalLogger(logger);

    await startHttpServer({ config });
    logger.info("HTTP server started", {
        host: config.http.host,
        port: config.http.port,
    });

    logger.debug("Paths", {
        configSources: config.configSources,
        cwd: process.cwd(),
        logFilePath: config.logger.logFilePath,
        tempDir: config.runtimeFiles.tempDir,
        userDataDir: config.runtimeFiles.userDataDir,
        promptLogFilePath: config.promptLog.filePath,
    });

    process.stdout.write(`Server is running at http://${config.http.host}:${config.http.port}\n`);
    process.stdout.write(`Config sources: ${config.configSources.join(", ")}\n`);
    process.stdout.write(`Working directory: ${process.cwd()}\n`);
    process.stdout.write(`Runtime paths: log=${config.logger.logFilePath}, temp=${config.runtimeFiles.tempDir}, userData=${config.runtimeFiles.userDataDir}, promptLog=${config.promptLog.filePath}\n`);
}

main().catch((error) => {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    process.stderr.write(`${message} \n`);
    process.exit(1);
});
