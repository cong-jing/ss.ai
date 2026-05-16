import { createStandardPromptRenderer } from "../base/createStandardPromptRenderer.js";
import { buildSystemMessages } from "../liveChat/systemPromptBuilder.js";
import { DM_NARRATOR_MAIN_TEMPLATE_PATH } from "./templatePaths.js";

export const dmNarratorPromptRenderer = createStandardPromptRenderer(async (input) => {
    return await buildSystemMessages({
        ...input,
        mainTemplatePath: DM_NARRATOR_MAIN_TEMPLATE_PATH,
    });
});
