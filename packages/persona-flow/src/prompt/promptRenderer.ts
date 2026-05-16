import type { PromptContext } from "./promptContext.js";
import { DEFAULT_PROMPT_MODE, type PromptMode } from "@ss-ai/contracts";
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
    single_character_chat: singleCharacterChatPromptRenderer,
    multi_character_event_log: multiCharacterEventLogPromptRenderer,
    dm_narrator: dmNarratorPromptRenderer,
    live_chat: liveChatPromptRenderer,
};

export const promptRenderer = {
    async render(context: PromptContext, options?: PromptRendererOptions): Promise<RenderedPrompt> {
        const promptMode = options?.promptMode ?? DEFAULT_PROMPT_MODE;
        const renderer = rendererByPromptMode[promptMode] ?? singleCharacterChatPromptRenderer;
        return await renderer.render(context, { mode: options?.mode });
    },
};
