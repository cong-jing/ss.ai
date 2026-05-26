import { cp, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(scriptDir, "..");
const sourceDataDir = resolve(packageRoot, "data");
const outputDataDir = resolve(packageRoot, "dist", "data");

await mkdir(outputDataDir, { recursive: true });
await cp(sourceDataDir, outputDataDir, { recursive: true });

process.stdout.write("Copied persona-flow assets to dist/data.\n");
