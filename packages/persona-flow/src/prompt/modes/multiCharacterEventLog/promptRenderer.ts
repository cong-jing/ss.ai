import { createStandardPromptRenderer } from "../base/createStandardPromptRenderer.js";
import { buildSystemMessages } from "../liveChat/systemPromptBuilder.js";
import { MULTI_CHARACTER_EVENT_LOG_MAIN_TEMPLATE_PATH } from "./templatePaths.js";

export const multiCharacterEventLogPromptRenderer = createStandardPromptRenderer(async (input) => {
    return await buildSystemMessages({
        ...input,
        mainTemplatePath: MULTI_CHARACTER_EVENT_LOG_MAIN_TEMPLATE_PATH,
    });
});
