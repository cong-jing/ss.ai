import type { PromptContext } from "./promptConext.js";
import { buildSystemMessages, type RenderedMessage, type BuildSystemMessagesInput } from "./systemPromptBuilder.js";
import { buildActorAliases } from "./actorAlias.js";
import { getPromptBlocks } from "./localizedPromptBlocks.js";

export type { RenderedMessage, BuildSystemMessagesInput };

/**
 * Rendered prompt structure with all messages for the LLM.
 * Used by ModelClient adapters to construct SDK-specific message formats.
 */
export type RenderedPrompt = {
    messages: RenderedMessage[];
};

export type PromptRenderMode = "non-structured" | "structured";

const FALLBACK_STRUCTURED_RESPONSE_INSTRUCTION = [
    "你必须输出一个 JSON 对象，不要输出任何对象外的文本。",
    "JSON 对象必须包含字段: action, replyText, control, skip。",
    "action 只能是 'reply' 或 'skip'。",
    "当 action='reply' 时，replyText 填写你要发送的回复；当 action='skip' 时，replyText 设为空字符串。",
    "control 中 summarizeSuggested 为布尔值，summarizeReason 为字符串，summarizeUrgency 取值为 none/low/normal/high。",
    "skip 中 reasonCode 取值为 none/not_addressed/low_value/rate_control/character_busy/waiting_for_others/other，reason 为字符串。",
].join("\n");

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

function stripAssistantPrefixes(content: string, aliasToken?: string, displayName?: string): string {
    let output = content.trimStart();

    // Remove one or more generated actor alias prefixes: p1[SS]:
    output = stripRepeatedPrefix(output, /^p\d+\[[^\]]+\]\s*[:：]\s*/u);

    // Remove one or more direct name prefixes for self actor: SS:
    const name = displayName?.trim();
    if (name) {
        const escaped = escapeRegExp(name);
        output = stripRepeatedPrefix(output, new RegExp(`^${escaped}\\s*[:：]\\s*`, "u"));
    }

    // Fallback: alias token from current actor map, if provided.
    if (aliasToken) {
        const escapedAlias = escapeRegExp(aliasToken);
        output = stripRepeatedPrefix(output, new RegExp(`^${escapedAlias}\\s*[:：]\\s*`, "u"));
    }

    return output;
}

export const promptRenderer = {
    render(context: PromptContext, options?: { mode?: PromptRenderMode }): RenderedPrompt {
        const mode: PromptRenderMode = options?.mode ?? "non-structured";
        const selfActor = context.actors.find(actor => actor.role === "self");
        const preferredSelfName = context.character?.displayName || context.character?.name;
        const aliasOverrides = new Map<string, string>();
        if (selfActor && preferredSelfName) {
            aliasOverrides.set(selfActor.id, preferredSelfName);
        }

        const { aliasByActorId } = buildActorAliases(context.actors, {
            displayNameOverridesByActorId: aliasOverrides,
        });

        const systemMessages = buildSystemMessages({
            character: context.character,
            userProfile: context.userProfile,
            actors: context.actors,
            language: context.character?.language ?? undefined,
        });
        const promptBlocks = getPromptBlocks(context.character?.language ?? undefined);
        const structuredInstruction = promptBlocks.structuredResponseInstruction || FALLBACK_STRUCTURED_RESPONSE_INSTRUCTION;

        // Each history message becomes "DisplayName: content" with the correct LLM role.
        const historyMessages: RenderedMessage[] = context.recentMessages.map(m => {
            const actor = context.actorMap.get(m.senderActorId);
            const role = actor ? toLlmRole(actor.role) : "user";
            const alias = aliasByActorId.get(m.senderActorId);
            const label = alias?.token ?? `p?[${actor?.displayName ?? m.senderActorId}]`;
            const normalized = role === "assistant"
                ? stripAssistantPrefixes(m.content, alias?.token, alias?.displayName || actor?.displayName)
                : m.content;
            return { role, content: `${label}: ${normalized}` };
        });

        const currentActor = context.actorMap.get(context.currentUserMessage.senderActorId);
        const currentAlias = aliasByActorId.get(context.currentUserMessage.senderActorId);
        const currentLabel = currentAlias?.token ?? `p?[${currentActor?.displayName ?? context.currentUserMessage.senderActorId}]`;
        const userMessage: RenderedMessage = {
            role: "user",
            content: `${currentLabel}: ${context.currentUserMessage.content}`,
        };

        const structuredInstructionMessage: RenderedMessage[] = mode === "structured"
            ? [{ role: "system", content: structuredInstruction }]
            : [];

        return { messages: [...systemMessages, ...structuredInstructionMessage, ...historyMessages, userMessage] };
    },
};
