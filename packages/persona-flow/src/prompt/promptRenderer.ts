import type { PromptContext } from "./promptConext.js";
import { buildSystemMessages, type RenderedMessage, type BuildSystemMessagesInput } from "./systemPromptBuilder.js";

export type { RenderedMessage, BuildSystemMessagesInput };

/**
 * Rendered prompt structure with all messages for the LLM.
 * Used by ModelClient adapters to construct SDK-specific message formats.
 */
export type RenderedPrompt = {
    messages: RenderedMessage[];
};

export const promptRenderer = {
    render(context: PromptContext): RenderedPrompt {
        const systemMessages = buildSystemMessages({
            character: context.character,
            userProfile: context.userProfile,
            language: context.character?.language ?? undefined,
        });

        const historyMessages: RenderedMessage[] = context.recentMessages.map(m => ({
            role: m.role as "user" | "assistant",
            content: m.content,
        }));

        const userMessage: RenderedMessage = {
            role: "user",
            content: context.currentUserMessage.content,
        };

        return { messages: [...systemMessages, ...historyMessages, userMessage] };
    },
};
