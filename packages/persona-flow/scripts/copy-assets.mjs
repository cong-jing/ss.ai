import { cp, mkdir, readdir } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(scriptDir, "..");
const sourceRootDir = resolve(packageRoot, "src");
const outputRootDir = resolve(packageRoot, "dist");

let copiedTemplateDirCount = 0;

async function copyTemplateDirectories(inputDir) {
    const entries = await readdir(inputDir, { withFileTypes: true });

    for (const entry of entries) {
        if (!entry.isDirectory()) {
            continue;
        }

        const sourceEntryPath = resolve(inputDir, entry.name);
        if (entry.name === "templates") {
            const relativePath = relative(sourceRootDir, sourceEntryPath);
            const outputEntryPath = resolve(outputRootDir, relativePath);
            await mkdir(dirname(outputEntryPath), { recursive: true });
            await cp(sourceEntryPath, outputEntryPath, { recursive: true });
            copiedTemplateDirCount += 1;
            continue;
        }

        await copyTemplateDirectories(sourceEntryPath);
    }
}

await copyTemplateDirectories(sourceRootDir);

process.stdout.write(`Copied ${copiedTemplateDirCount} template directory(ies) to dist.\n`);
