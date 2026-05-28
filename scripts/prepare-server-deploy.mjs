import { access, cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const deployRootArg = process.argv[2];
const appEnv = process.argv[3];

if (!deployRootArg || !appEnv) {
    throw new Error("Usage: node scripts/prepare-server-deploy.mjs <deploy-root> <app-env>");
}

const deployRoot = resolve(repoRoot, deployRootArg);
const sourceConfigDir = resolve(repoRoot, "config");
const sourceSchemaDir = resolve(repoRoot, "schemas");
const sourceEnvConfig = resolve(sourceConfigDir, `config.${appEnv}.json`);
const deployPackageJsonPath = resolve(deployRoot, "package.json");
const configWhitelist = [
    "config.default.json",
    `config.${appEnv}.json`,
    "config.local.json.example",
];

try {
    await access(sourceEnvConfig);
} catch {
    throw new Error(`Missing runtime config for APP_ENV=${appEnv}: ${sourceEnvConfig}`);
}

await mkdir(resolve(deployRoot, "schemas"), { recursive: true });
await mkdir(resolve(deployRoot, "config"), { recursive: true });
await cp(sourceSchemaDir, resolve(deployRoot, "schemas"), { recursive: true });
for (const configFile of configWhitelist) {
    const sourceFile = resolve(sourceConfigDir, configFile);
    const isOptional = configFile === "config.local.json.example";
    try {
        await access(sourceFile);
        await cp(sourceFile, resolve(deployRoot, "config", configFile));
    } catch {
        if (isOptional) {
            process.stdout.write(`Skipping optional config file: ${configFile}\n`);
        } else {
            throw new Error(`Missing required config file: ${configFile} (expected at ${sourceFile})`);
        }
    }
}

const deployPackageRaw = await readFile(deployPackageJsonPath, "utf-8");
const deployPackage = JSON.parse(deployPackageRaw);

deployPackage.scripts = {
    ...deployPackage.scripts,
    start: `APP_ENV=${appEnv} node dist/index.js`,
};

await writeFile(deployPackageJsonPath, `${JSON.stringify(deployPackage, null, 2)}\n`, "utf-8");

process.stdout.write(`Prepared server deploy root assets for APP_ENV=${appEnv}.\n`);
