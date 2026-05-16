import type { PromptContext } from "./promptContext.js";
import { PromptMode } from "./promptMode.js";
import type { ModePromptRenderer, PromptRendererOptions, RenderedPrompt } from "./promptTypes.js";
import { dmNarratorPromptRenderer } from "./modes/dmNarrator/promptRenderer.js";
import { liveChatPromptRenderer } from "./modes/liveChat/promptRenderer.js";
import { multiCharacterEventLogPromptRenderer } from "./modes/multiCharacterEventLog/promptRenderer.js";
import { singleCharacterChatPromptRenderer } from "./modes/singleCharacterChat/promptRenderer.js";

export type {
    RenderedMessage,
    PromptRenderMode,
    PromptRendererOptions,
    RenderedPrompt,
} from "./promptTypes.js";

const rendererByPromptMode: Record<PromptMode, ModePromptRenderer> = {
    [PromptMode.SingleCharacterChat]: singleCharacterChatPromptRenderer,
    [PromptMode.MultiCharacterEventLog]: multiCharacterEventLogPromptRenderer,
    [PromptMode.DmNarrator]: dmNarratorPromptRenderer,
    [PromptMode.LiveChat]: liveChatPromptRenderer,
};

export const promptRenderer = {
    async render(context: PromptContext, options?: PromptRendererOptions): Promise<RenderedPrompt> {
        const promptMode = options?.promptMode ?? PromptMode.SingleCharacterChat;
        const renderer = rendererByPromptMode[promptMode] ?? singleCharacterChatPromptRenderer;
        return await renderer.render(context, { mode: options?.mode });
    },
};
