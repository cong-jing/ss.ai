import type { PromptContext } from "./promptContext.js";
import { buildSystemMessages, type RenderedMessage } from "./system/systemPromptBuilder.js";
import { buildActorSpeakerTags } from "./speakerTag.js";

/**
 * Rendered prompt structure with all messages for the LLM.
 * Used by ModelClient adapters to construct SDK-specific message formats.
 */
export type RenderedPrompt = {
    messages: RenderedMessage[];
};

export type PromptRenderMode = "non-structured" | "structured";

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

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripRepeatedPrefix(text: string, regex: RegExp): string {
    let output = text;
    while (regex.test(output)) {
        output = output.replace(regex, "");
    }
    return output;
}

function stripAssistantPrefixes(content: string, speakerTag?: string, displayName?: string): string {
    let output = content.trimStart();

    // Remove one or more generated speaker tag prefixes: p1[SS]:
    output = stripRepeatedPrefix(output, /^p\d+\[[^\]]+\]\s*[:：]\s*/u);

    // Remove one or more direct name prefixes for self actor: SS:
    const name = displayName?.trim();
    if (name) {
        const escaped = escapeRegExp(name);
        output = stripRepeatedPrefix(output, new RegExp(`^${escaped}\\s*[:：]\\s*`, "u"));
    }

    // Fallback: speaker tag from current actor map, if provided.
    if (speakerTag) {
        const escapedTag = escapeRegExp(speakerTag);
        output = stripRepeatedPrefix(output, new RegExp(`^${escapedTag}\\s*[:：]\\s*`, "u"));
    }

    return output;
}

export const promptRenderer = {
    async render(context: PromptContext, options?: { mode?: PromptRenderMode }): Promise<RenderedPrompt> {
        const mode: PromptRenderMode = options?.mode ?? "non-structured";
        const selfActor = context.actors.find(actor => actor.role === "self");
        const preferredSelfName = context.character?.displayName || context.character?.name;
        const aliasOverrides = new Map<string, string>();
        if (selfActor && preferredSelfName) {
            aliasOverrides.set(selfActor.id, preferredSelfName);
        }

        const { speakerTagByActorId } = buildActorSpeakerTags(context.actors, {
            displayNameOverridesByActorId: aliasOverrides,
        });

        const systemMessages = await buildSystemMessages({
            character: context.character,
            userProfile: context.userProfile,
            actors: context.actors,
            structuredOutput: mode === "structured",
        });

        // Each history message becomes "DisplayName: content" with the correct LLM role.
        const historyMessages: RenderedMessage[] = context.recentMessages.map(m => {
            const actor = context.actorMap.get(m.senderActorId);
            const role = actor ? toLlmRole(actor.role) : "user";
            const tag = speakerTagByActorId.get(m.senderActorId);
            const label = tag?.speakerTag ?? `p?[${actor?.displayName ?? m.senderActorId}]`;
            const normalized = role === "assistant"
                ? stripAssistantPrefixes(m.content, tag?.speakerTag, tag?.displayName || actor?.displayName)
                : m.content;
            return { role, content: `${label}: ${normalized}` };
        });

        const currentActor = context.actorMap.get(context.currentUserMessage.senderActorId);
        const currentTag = speakerTagByActorId.get(context.currentUserMessage.senderActorId);
        const currentLabel = currentTag?.speakerTag ?? `p?[${currentActor?.displayName ?? context.currentUserMessage.senderActorId}]`;
        const userMessage: RenderedMessage = {
            role: "user",
            content: `${currentLabel}: ${context.currentUserMessage.content}`,
        };

        return { messages: [...systemMessages, ...historyMessages, userMessage] };
    },
};
