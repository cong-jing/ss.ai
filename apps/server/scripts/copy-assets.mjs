import { cp, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(scriptDir, "..");
const sourceDir = resolve(appRoot, "src", "characterTemplates", "templates");
const outputDir = resolve(appRoot, "dist", "characterTemplates", "templates");

await mkdir(dirname(outputDir), { recursive: true });
await cp(sourceDir, outputDir, { recursive: true });
process.stdout.write("Copied server character template assets.\n");
