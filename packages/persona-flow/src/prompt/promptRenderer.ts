import type { PromptContext } from "./promptConext.js";
import { buildSystemMessages, type RenderedMessage, type BuildSystemMessagesInput } from "./systemPromptBuilder.js";
import { buildActorAliases } from "./actorAlias.js";

export type { RenderedMessage, BuildSystemMessagesInput };

/**
 * Rendered prompt structure with all messages for the LLM.
 * Used by ModelClient adapters to construct SDK-specific message formats.
 */
export type RenderedPrompt = {
    messages: RenderedMessage[];
};

/**
 * Map an actor role to an LLM message role.
 * - self (AI)  → assistant
 * - system     → system
 * - other      → user
 */
function toLlmRole(actorRole: string): "system" | "user" | "assistant" {
    if (actorRole === "self") return "assistant";
    if (actorRole === "system") return "system";
    return "user";
}

export const promptRenderer = {
    render(context: PromptContext): RenderedPrompt {
        const { aliasByActorId } = buildActorAliases(context.actors);

        const systemMessages = buildSystemMessages({
            character: context.character,
            userProfile: context.userProfile,
            actors: context.actors,
            language: context.character?.language ?? undefined,
        });

        // Each history message becomes "DisplayName: content" with the correct LLM role.
        const historyMessages: RenderedMessage[] = context.recentMessages.map(m => {
            const actor = context.actorMap.get(m.senderActorId);
            const role = actor ? toLlmRole(actor.role) : "user";
            const alias = aliasByActorId.get(m.senderActorId);
            const label = alias?.token ?? `p?[${actor?.displayName ?? m.senderActorId}]`;
            return { role, content: `${label}: ${m.content}` };
        });

        const currentActor = context.actorMap.get(context.currentUserMessage.senderActorId);
        const currentAlias = aliasByActorId.get(context.currentUserMessage.senderActorId);
        const currentLabel = currentAlias?.token ?? `p?[${currentActor?.displayName ?? context.currentUserMessage.senderActorId}]`;
        const userMessage: RenderedMessage = {
            role: "user",
            content: `${currentLabel}: ${context.currentUserMessage.content}`,
        };

        return { messages: [...systemMessages, ...historyMessages, userMessage] };
    },
};
