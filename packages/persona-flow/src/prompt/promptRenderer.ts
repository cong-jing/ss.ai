import type { PromptContext } from "./promptContext.js";
import type { PromptRendererOptions, RenderedMessage, RenderedPrompt } from "./promptTypes.js";
import { renderPrompt as renderSingleCharacterPrompt } from "./modes/singleCharacterChat/renderPrompt.js";
import { InteractionModeValue } from "@ss-ai/contracts";

export type {
    RenderedMessage,
    PromptRenderMode,
    PromptRendererOptions,
    RenderedPrompt,
} from "./promptTypes.js";


export const promptRenderer = {
    async render(context: PromptContext, options?: PromptRendererOptions): Promise<RenderedPrompt> {
        // const mode = options?.mode ?? "non-structured";

        switch (options?.interactionMode) {
            case InteractionModeValue.singleCharacterChat:
                return renderSingleCharacterPrompt(context, options);
            default:
                context.logger?.warn(
                    `Unknown interaction mode "${options?.interactionMode}", falling back to "${InteractionModeValue.singleCharacterChat}"`,
                );
                return renderSingleCharacterPrompt(context, options);
        }

    },
};
