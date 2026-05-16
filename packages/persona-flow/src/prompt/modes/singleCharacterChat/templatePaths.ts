import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dir = dirname(fileURLToPath(import.meta.url));

export const SINGLE_CHARACTER_CHAT_MAIN_TEMPLATE_PATH = resolve(
    __dir,
    "../../../../data/prompts/zh-CN/single_character_chat/main.md.hbs",
);
