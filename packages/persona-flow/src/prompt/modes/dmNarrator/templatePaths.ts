import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dir = dirname(fileURLToPath(import.meta.url));

export const DM_NARRATOR_MAIN_TEMPLATE_PATH = resolve(
    __dir,
    "../../../../data/prompts/zh-CN/dm_narrator/main.md.hbs",
);
