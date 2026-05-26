import { cp, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const serverRoot = resolve(scriptDir, "..");
const repoRoot = resolve(serverRoot, "..", "..");

const distRoot = resolve(serverRoot, "dist");
const sourceSchemaDir = resolve(repoRoot, "schemas");
const sourceDefaultConfig = resolve(repoRoot, "config.default.json");
const sourceLocalConfigExample = resolve(repoRoot, "config.local.json.example");

await mkdir(resolve(distRoot, "schemas"), { recursive: true });
await cp(sourceSchemaDir, resolve(distRoot, "schemas"), { recursive: true });
await cp(sourceDefaultConfig, resolve(distRoot, "config.default.json"));
await cp(sourceLocalConfigExample, resolve(distRoot, "config.local.json.example"));

process.stdout.write("Copied server runtime assets to dist.\n");
