import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const appEnv = process.argv[2];
const deployRootArg = process.argv[3] ?? "./.deploy";

if (!appEnv) {
    throw new Error("Usage: node scripts/start-server.mjs <app-env> [deploy-root]");
}

const deployRoot = resolve(repoRoot, deployRootArg);
const deployServerRoot = resolve(deployRoot, "server");
const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

const result = spawnSync(pnpmCommand, ["--dir", deployServerRoot, "start"], {
    cwd: repoRoot,
    stdio: "inherit",
    env: {
        ...process.env,
        APP_ENV: appEnv,
    },
});

if (result.error) {
    throw result.error;
}

if (result.status !== 0 || result.signal != null) {
    process.exit(result.status ?? 1);
}
