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

/**
 * Map a participant role to an LLM message role.
 * - self (AI)  → assistant
 * - system     → system
 * - other      → user
 */
function toLlmRole(participantRole: string): "system" | "user" | "assistant" {
    if (participantRole === "self") return "assistant";
    if (participantRole === "system") return "system";
    return "user";
}

export const promptRenderer = {
    render(context: PromptContext): RenderedPrompt {
        const systemMessages = buildSystemMessages({
            character: context.character,
            userProfile: context.userProfile,
            participants: context.participants,
            language: context.character?.language ?? undefined,
        });

        // Each history message becomes "DisplayName: content" with the correct LLM role.
        const historyMessages: RenderedMessage[] = context.recentMessages.map(m => {
            const participant = context.participantMap.get(m.senderParticipantId);
            const role = participant ? toLlmRole(participant.role) : "user";
            const label = participant?.displayName ?? m.senderParticipantId;
            return { role, content: `${label}: ${m.content}` };
        });

        const currentParticipant = context.participantMap.get(context.currentUserMessage.senderParticipantId);
        const currentLabel = currentParticipant?.displayName ?? context.currentUserMessage.senderParticipantId;
        const userMessage: RenderedMessage = {
            role: "user",
            content: `${currentLabel}: ${context.currentUserMessage.content}`,
        };

        return { messages: [...systemMessages, ...historyMessages, userMessage] };
    },
};
