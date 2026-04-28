import fs from "node:fs";
import { loadRuntimeConfig } from "./util/config.js";
import { startHttpServer } from "./http/server.js";
import { createLogger, setGlobalLogger } from "./util/logger.js";

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
        port: config.http.port
    });
    process.stdout.write(`Server is running at http://${config.http.host}:${config.http.port}\n`);
}

main().catch((error) => {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    process.stderr.write(`${message} \n`);
    process.exit(1);
});
