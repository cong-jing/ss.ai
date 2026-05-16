import type { PromptContext } from "./promptContext.js";
import type { PromptMode } from "./promptMode.js";

export type RenderedMessage = {
    role: "system" | "user" | "assistant";
    content: string;
};

export type RenderedPrompt = {
    messages: RenderedMessage[];
};

export type PromptRenderMode = "non-structured" | "structured";

export interface PromptRendererOptions {
    mode?: PromptRenderMode;
    promptMode?: PromptMode;
}

export interface ModePromptRenderer {
    render(context: PromptContext, options?: { mode?: PromptRenderMode }): Promise<RenderedPrompt>;
}
