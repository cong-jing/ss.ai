import fs from "node:fs";
import { AgentService } from "../packages/agent/src";
import { runCli } from "./cli";
import { loadRuntimeConfig } from "./config";
import { startHttpServer } from "./http/server";
import { createLogger } from "./logger";

async function main(): Promise<void> {
    const mode = process.argv[2] ?? "serve";
    const config = loadRuntimeConfig();

    fs.mkdirSync(config.runtimeFiles.tempDir, { recursive: true });
    fs.mkdirSync(config.runtimeFiles.userDataDir, { recursive: true });

    const logger = createLogger({
        level: config.logger.level,
        filePath: config.logger.filePath,
        outputStack: config.logger.outputStack,
        stackLevel: 0,
    });

    const agentService = new AgentService(config.agent, {
        logger
        // TODO: inject real ModelClient implementation (OpenAI/Azure/Anthropic/etc.) here.
    });

    if (mode === "cli") {
        const cliArgv = [process.argv[0], process.argv[1], ...process.argv.slice(3)];
        await runCli({ agentService, config, argv: cliArgv });
        return;
    }

    if (mode === "serve") {
        await startHttpServer({ agentService, config });
        logger.info("HTTP server started", {
            host: config.http.host,
            port: config.http.port
        });
        return;
    }

    logger.error("Unknown mode", { mode });
    process.exitCode = 1;
}

main().catch((error) => {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exit(1);
});
