import type { PromptContext } from "./promptContext.js";
import type { PromptRendererOptions, RenderedMessage, RenderedPrompt } from "./promptTypes.js";
import { renderPrompt as renderSingleCharacterPrompt } from "./modes/singleCharacterChat/renderPrompt.js";

export type {
    RenderedMessage,
    PromptRenderMode,
    PromptRendererOptions,
    RenderedPrompt,
} from "./promptTypes.js";


export const promptRenderer = {
    async render(context: PromptContext, options?: PromptRendererOptions): Promise<RenderedPrompt> {
        // const mode = options?.mode ?? "non-structured";

        switch (options?.promptMode) {
            case "single_character_chat":
                return renderSingleCharacterPrompt(context, options);
            default:
                context.logger?.warn(`Unknown prompt mode "${options?.promptMode}", falling back to "single_character_chat"`);
                return renderSingleCharacterPrompt(context, options);
        }

    },
};
