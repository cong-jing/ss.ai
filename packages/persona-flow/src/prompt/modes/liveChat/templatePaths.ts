import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dir = dirname(fileURLToPath(import.meta.url));

export const LIVE_CHAT_MAIN_TEMPLATE_PATH = resolve(
    __dir,
    "../../../../data/prompts/zh-CN/live_chat/main.md.hbs",
);
