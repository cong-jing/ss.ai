import { createStandardPromptRenderer } from "../base/createStandardPromptRenderer.js";
import { buildSystemMessages } from "../liveChat/systemPromptBuilder.js";
import { SINGLE_CHARACTER_CHAT_MAIN_TEMPLATE_PATH } from "./templatePaths.js";

export const singleCharacterChatPromptRenderer = createStandardPromptRenderer(async (input) => {
    return await buildSystemMessages({
        ...input,
        mainTemplatePath: SINGLE_CHARACTER_CHAT_MAIN_TEMPLATE_PATH,
    });
});
