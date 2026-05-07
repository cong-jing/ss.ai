import type { PromptContext } from "./promptConext.js";

/**
 * A single message in the rendered prompt, using a unified role vocabulary.
 * Each ModelClient adapter maps this to its SDK's own message format.
 */
export type RenderedMessage = {
    role: "system" | "user" | "assistant";
    content: string;
};

export type RenderedPrompt = {
    messages: RenderedMessage[];
};

function buildSystemMessages(context: PromptContext): RenderedMessage[] {
    const parts: string[] = [];

    if (context.character) {
        parts.push(context.character.personaPrompt);
    }

    if (context.userProfile) {
        const name = context.userProfile.preferredAddress ?? context.userProfile.name;
        if (name) {
            parts.push(`The user's name is ${name}.`);
        }
        if (context.userProfile.bio) {
            parts.push(`About the user: ${context.userProfile.bio}`);
        }
    }

    const systemText = parts.join("\n\n");
    return systemText ? [{ role: "system", content: systemText }] : [];
}

export const promptRenderer = {
    render(context: PromptContext): RenderedPrompt {
        const systemMessages = buildSystemMessages(context);
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
