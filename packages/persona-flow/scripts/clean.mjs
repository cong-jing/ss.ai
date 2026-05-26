import { rm } from "node:fs/promises";

await rm("dist", { recursive: true, force: true });

process.stdout.write("Cleaned persona-flow dist.\n");
