import { cp, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const serverRoot = resolve(scriptDir, "..");
const repoRoot = resolve(serverRoot, "..", "..");

const distRoot = resolve(serverRoot, "dist");
const sourceConfigDir = resolve(repoRoot, "config");
const sourceSchemaDir = resolve(repoRoot, "schemas");
const configWhitelist = [
    "config.default.json",
    "config.staging.json",
    "config.prod.json",
    "config.local.json.example",
];

await mkdir(resolve(distRoot, "schemas"), { recursive: true });
await mkdir(resolve(distRoot, "config"), { recursive: true });
await cp(sourceSchemaDir, resolve(distRoot, "schemas"), { recursive: true });
for (const configFile of configWhitelist) {
    await cp(
        resolve(sourceConfigDir, configFile),
        resolve(distRoot, "config", configFile),
    );
}

process.stdout.write("Copied server runtime assets to dist.\n");
