import type { Character, UserProfile } from "../../../index.js";
import type { ConversationActor } from "../../../stores/character/conversationActor.js";
import type { RenderedMessage } from "../../promptTypes.js";
import { buildPromptViewModel } from "./buildPromptViewModel.js";
import { renderPromptTemplate } from "./renderPromptTemplate.js";
import { LIVE_CHAT_MAIN_TEMPLATE_PATH } from "./templatePaths.js";

export interface BuildSystemMessagesInput {
    character: Character | null;
    userProfile: UserProfile | null;
    actors?: ConversationActor[] | null;
    relationshipState?: string | null;
    memories?: string[] | null;
    structuredOutput?: boolean;
    mainTemplatePath?: string;
}

export async function buildSystemMessages(input: BuildSystemMessagesInput): Promise<RenderedMessage[]> {
    const viewModel = buildPromptViewModel({
        character: input.character,
        userProfile: input.userProfile,
        actors: input.actors,
        relationshipState: input.relationshipState,
        memories: input.memories,
        structuredOutput: input.structuredOutput ?? false,
    });

    const templatePath = input.mainTemplatePath ?? LIVE_CHAT_MAIN_TEMPLATE_PATH;
    const systemPrompt = (await renderPromptTemplate(templatePath, viewModel)).trim();
    if (!systemPrompt) return [];

    return [{
        role: "system",
        content: systemPrompt,
    }];
}
