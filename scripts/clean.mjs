import { readdir, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const roots = ["apps", "packages"];
const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");

async function removePath(path) {
    await rm(path, { recursive: true, force: true });
}

await removePath(resolve(repoRoot, "deploy"));
await removePath(resolve(repoRoot, ".deploy-staging"));
await removePath(resolve(repoRoot, ".deploy-prod"));
await removePath(resolve(repoRoot, "node_modules"));
await removePath(resolve(repoRoot, "package-lock.json"));
await removePath(resolve(repoRoot, "npm-shrinkwrap.json"));
await removePath(resolve(repoRoot, "yarn.lock"));

for (const root of roots) {
    let children = [];
    try {
        children = await readdir(resolve(repoRoot, root), { withFileTypes: true });
    } catch {
        continue;
    }

    for (const child of children) {
        if (!child.isDirectory()) {
            continue;
        }

        const base = resolve(repoRoot, root, child.name);
        await removePath(join(base, "dist"));
        await removePath(join(base, "deploy"));
        await removePath(join(base, "node_modules"));
        await removePath(join(base, "package-lock.json"));
        await removePath(join(base, "npm-shrinkwrap.json"));
        await removePath(join(base, "yarn.lock"));
    }
}

process.stdout.write("Cleaned workspace artifacts.\n");
