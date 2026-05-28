import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";

const roots = ["apps", "packages"];

async function removePath(path) {
    await rm(path, { recursive: true, force: true });
}

await removePath("deploy");
await removePath(".deploy-staging");
await removePath(".deploy-prod");
await removePath("node_modules");
await removePath("package-lock.json");
await removePath("npm-shrinkwrap.json");
await removePath("yarn.lock");

for (const root of roots) {
    let children = [];
    try {
        children = await readdir(root);
    } catch {
        continue;
    }

    for (const child of children) {
        const base = join(root, child);
        await removePath(join(base, "dist"));
        await removePath(join(base, "deploy"));
        await removePath(join(base, "node_modules"));
        await removePath(join(base, "package-lock.json"));
        await removePath(join(base, "npm-shrinkwrap.json"));
        await removePath(join(base, "yarn.lock"));
    }
}

process.stdout.write("Cleaned workspace artifacts.\n");
