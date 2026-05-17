import type { PromptMode } from "@ss-ai/contracts";

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
