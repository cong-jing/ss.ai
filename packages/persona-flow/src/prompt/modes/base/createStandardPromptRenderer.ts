import type { PromptContext } from "../../promptContext.js";
import type {
    ModePromptRenderer,
    PromptRenderMode,
    RenderedMessage,
    RenderedPrompt,
} from "../../promptTypes.js";
import { buildActorSpeakerTags } from "../../speakerTag.js";

export interface BuildModeSystemMessagesInput {
    character: PromptContext["character"];
    userProfile: PromptContext["userProfile"];
    actors?: PromptContext["actors"];
    relationshipState?: string | null;
    memories?: string[] | null;
    structuredOutput?: boolean;
}

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

    output = stripRepeatedPrefix(output, /^p\d+\[[^\]]+\]\s*[:：]\s*/u);

    const name = displayName?.trim();
    if (name) {
        const escaped = escapeRegExp(name);
        output = stripRepeatedPrefix(output, new RegExp(`^${escaped}\\s*[:：]\\s*`, "u"));
    }

    if (speakerTag) {
        const escapedTag = escapeRegExp(speakerTag);
        output = stripRepeatedPrefix(output, new RegExp(`^${escapedTag}\\s*[:：]\\s*`, "u"));
    }

    return output;
}

function renderWithSystemBuilder(
    context: PromptContext,
    mode: PromptRenderMode,
    buildModeSystemMessages: (input: BuildModeSystemMessagesInput) => Promise<RenderedMessage[]>,
): Promise<RenderedPrompt> {
    const selfActor = context.actors.find(actor => actor.role === "self");
    const preferredSelfName = context.character?.displayName || context.character?.name;
    const aliasOverrides = new Map<string, string>();
    if (selfActor && preferredSelfName) {
        aliasOverrides.set(selfActor.id, preferredSelfName);
    }

    const { speakerTagByActorId } = buildActorSpeakerTags(context.actors, {
        displayNameOverridesByActorId: aliasOverrides,
    });

    return buildModeSystemMessages({
        character: context.character,
        userProfile: context.userProfile,
        actors: context.actors,
        structuredOutput: mode === "structured",
    }).then(systemMessages => {
        const historyMessages: RenderedMessage[] = context.recentMessages.map(message => {
            const actor = context.actorMap.get(message.senderActorId);
            const role = actor ? toLlmRole(actor.role) : "user";
            const tag = speakerTagByActorId.get(message.senderActorId);
            const label = tag?.speakerTag ?? `p?[${actor?.displayName ?? message.senderActorId}]`;
            const normalized = role === "assistant"
                ? stripAssistantPrefixes(message.content, tag?.speakerTag, tag?.displayName || actor?.displayName)
                : message.content;
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
    });
}

export function createStandardPromptRenderer(
    buildModeSystemMessages: (input: BuildModeSystemMessagesInput) => Promise<RenderedMessage[]>,
): ModePromptRenderer {
    return {
        async render(context: PromptContext, options?: { mode?: PromptRenderMode }): Promise<RenderedPrompt> {
            const mode: PromptRenderMode = options?.mode ?? "non-structured";
            return await renderWithSystemBuilder(context, mode, buildModeSystemMessages);
        },
    };
}
