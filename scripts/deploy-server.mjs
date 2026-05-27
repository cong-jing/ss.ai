import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const appEnv = process.argv[2];
const deployRoot = process.argv[3];

if (!appEnv || !deployRoot) {
    throw new Error("Usage: node scripts/deploy-server.mjs <app-env> <deploy-root>");
}

function runCommand(command, args) {
    const result = spawnSync(command, args, {
        cwd: repoRoot,
        stdio: "inherit",
    });

    if (result.error) {
        throw result.error;
    }

    if (result.status !== 0) {
        process.exit(result.status ?? 1);
    }
}

const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

runCommand(pnpmCommand, [
    "--filter",
    "@ss-ai/server",
    "--prod",
    "--force",
    "deploy",
    deployRoot,
]);

runCommand(process.execPath, [
    resolve(repoRoot, "scripts", "prepare-server-deploy.mjs"),
    deployRoot,
    appEnv,
]);