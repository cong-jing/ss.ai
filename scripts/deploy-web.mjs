import { cp, mkdir, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const deployRootArg = process.argv[2] ?? "./.deploy";
const deployRoot = resolve(repoRoot, deployRootArg);
const deployWebRoot = resolve(deployRoot, "web");
const webDistDir = resolve(repoRoot, "apps", "web", "dist");

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
runCommand(pnpmCommand, ["--filter", "@ss-ai/web", "build"]);

await rm(deployWebRoot, { recursive: true, force: true });
await mkdir(deployRoot, { recursive: true });
await cp(webDistDir, deployWebRoot, { recursive: true });

process.stdout.write(`Prepared web deploy assets at ${deployWebRoot}.\n`);
