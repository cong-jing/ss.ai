import { rm, mkdir, symlink, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const deployBaseArg = process.argv[2];
const serviceName = process.argv[3] ?? "";
const releaseSha = process.argv[4];
const targetEnv = process.argv[5];
const defaultApiKeyPlaintext = process.argv[6] ?? "";

if (!deployBaseArg || !releaseSha || !targetEnv) {
    throw new Error(
        "Usage: node scripts/activate-lightsail-release.mjs <deploy-base> <service-name> <release-sha> <target-env> [default-api-key]",
    );
}

const deployBase = resolve(deployBaseArg);
const releasesDir = resolve(deployBase, targetEnv, "releases");
const releaseDir = resolve(releasesDir, releaseSha);
const currentLink = resolve(deployBase, targetEnv, "current");
const sharedRuntimeDir = resolve(deployBase, targetEnv, "shared");
const releaseConfigLocalPath = resolve(releaseDir, "server", "config", "config.local.json");
const archivePath = `/tmp/ss-ai-${targetEnv}-${releaseSha}.tgz`;

function runCommand(command, args) {
    const result = spawnSync(command, args, {
        stdio: "inherit",
    });

    if (result.error) {
        throw result.error;
    }

    if (result.status !== 0 || result.signal != null) {
        process.exit(result.status ?? 1);
    }
}

const deployOwner = process.env["USER"]?.trim() || runCommandWithOutput("id", ["-un"]);
const deployGroup = runCommandWithOutput("id", ["-gn"]);

runCommand("sudo", ["mkdir", "-p", deployBase]);
runCommand("sudo", ["chown", "-R", `${deployOwner}:${deployGroup}`, deployBase]);

await mkdir(releasesDir, { recursive: true });
await mkdir(sharedRuntimeDir, { recursive: true });
await rm(releaseDir, { recursive: true, force: true });
await mkdir(releaseDir, { recursive: true });

runCommand("tar", ["-xzf", archivePath, "-C", releaseDir]);

if (defaultApiKeyPlaintext.trim()) {
    const apiKey = defaultApiKeyPlaintext.trim();
    if (/[\r\n]/.test(apiKey)) {
        throw new Error("Invalid default API key: must not contain newline characters.");
    }

    const localConfig = {
        models: {
            "mistral.ai": {
                apiKey,
            },
        },
    };
    await writeFile(releaseConfigLocalPath, `${JSON.stringify(localConfig, null, 4)}\n`, { encoding: "utf8", mode: 0o600 });
    process.stdout.write(`Wrote runtime config.local.json for ${targetEnv}.\n`);
}

await rm(currentLink, { recursive: true, force: true });
await symlink(releaseDir, currentLink);

await rm(archivePath, { force: true });

if (serviceName) {
    runCommand("sudo", ["systemctl", "restart", serviceName]);
    runCommand("sudo", ["systemctl", "--no-pager", "--full", "status", serviceName]);
}

const releaseEntries = await rmOldReleases(releasesDir, releaseDir);
if (releaseEntries > 0) {
    process.stdout.write(`Removed ${releaseEntries} old release(s).\n`);
}

function runCommandWithOutput(command, args) {
    const result = spawnSync(command, args, {
        stdio: ["ignore", "pipe", "inherit"],
        encoding: "utf8",
    });

    if (result.error) {
        throw result.error;
    }

    if (result.status !== 0 || result.signal != null) {
        process.exit(result.status ?? 1);
    }

    return result.stdout.trim();
}

async function rmOldReleases(releasesRoot, activeReleaseDir) {
    const entries = await readdir(releasesRoot, { withFileTypes: true });
    let removed = 0;

    for (const entry of entries) {
        if (!entry.isDirectory()) {
            continue;
        }

        const fullPath = resolve(releasesRoot, entry.name);
        if (fullPath === activeReleaseDir) {
            continue;
        }

        await rm(fullPath, { recursive: true, force: true });
        removed += 1;
    }

    return removed;
}
