import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dir = dirname(fileURLToPath(import.meta.url));

export const MULTI_CHARACTER_EVENT_LOG_MAIN_TEMPLATE_PATH = resolve(
    __dir,
    "../../../../data/prompts/zh-CN/multi_character_event_log/main.md.hbs",
);
