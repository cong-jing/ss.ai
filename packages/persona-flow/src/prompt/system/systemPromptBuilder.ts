import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Character, UserProfile } from "../../index.js";
import type { ConversationActor } from "../../stores/character/conversationActor.js";
import { buildPromptViewModel } from "./buildPromptViewModel.js";
import { renderPromptTemplate } from "./renderPromptTemplate.js";

/**
 * A single message in the rendered prompt, using a unified role vocabulary.
 * Each ModelClient adapter maps this to its SDK's own message format.
 */
export type RenderedMessage = {
    role: "system" | "user" | "assistant";
    content: string;
};

export interface BuildSystemMessagesInput {
    character: Character | null;
    userProfile: UserProfile | null;
    actors?: ConversationActor[] | null;
    relationshipState?: string | null;
    memories?: string[] | null;
    structuredOutput?: boolean;
}

const __dir = dirname(fileURLToPath(import.meta.url));
const MAIN_TEMPLATE_PATH = resolve(__dir, "../../../data/prompts/zh-CN/main.md.hbs");

export async function buildSystemMessages(input: BuildSystemMessagesInput): Promise<RenderedMessage[]> {
    const viewModel = buildPromptViewModel({
        character: input.character,
        userProfile: input.userProfile,
        actors: input.actors,
        relationshipState: input.relationshipState,
        memories: input.memories,
        structuredOutput: input.structuredOutput ?? false,
    });

    const systemPrompt = (await renderPromptTemplate(MAIN_TEMPLATE_PATH, viewModel)).trim();
    if (!systemPrompt) return [];

    return [{
        role: "system",
        content: systemPrompt,
    }];
}
