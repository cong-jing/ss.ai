
import { PromptContext } from "../../promptContext.js";
import { RenderedMessage, PromptRendererOptions } from "../../promptTypes.js";
import { buildActorSpeakerTags } from "../../speakerTag.js";
import { buildPromptViewModel } from "./buildPromptViewModel.js";
import { renderPromptTemplate } from "../util/renderPromptTemplate.js";
import { SINGLE_CHARACTER_CHAT_MAIN_TEMPLATE_PATH } from "./templatePaths.js";

export async function renderPrompt(context: PromptContext, options?: PromptRendererOptions): Promise<{ messages: RenderedMessage[] }> {
    const mode = options?.mode ?? "non-structured";
    const systemMessages = await buildSystemMessages(context, mode === "structured");
    const chatMessages = buildConversationMessages(context);

    return {
        messages: [...systemMessages, ...chatMessages],
    };

}

async function buildSystemMessages(context: PromptContext, structuredOutput: boolean): Promise<RenderedMessage[]> {
    const viewModel = buildPromptViewModel({
        character: context.character,
        userProfile: context.userProfile,
        actors: context.actors,
        structuredOutput,
    });

    const systemPrompt = (await renderPromptTemplate(SINGLE_CHARACTER_CHAT_MAIN_TEMPLATE_PATH, viewModel)).trim();
    if (!systemPrompt) {
        return [];
    }

    return [{ role: "system", content: systemPrompt }];
}

function buildConversationMessages(context: PromptContext): RenderedMessage[] {
    const selfActor = context.actors.find(actor => actor.role === "self");
    const preferredSelfName = context.character?.displayName || context.character?.name;
    const aliasOverrides = new Map<string, string>();
    if (selfActor && preferredSelfName) {
        aliasOverrides.set(selfActor.id, preferredSelfName);
    }

    const { speakerTagByActorId } = buildActorSpeakerTags(context.actors, {
        displayNameOverridesByActorId: aliasOverrides,
    });

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

    return [...historyMessages, userMessage];
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
