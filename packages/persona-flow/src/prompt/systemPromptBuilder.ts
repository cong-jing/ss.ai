/**
 * System prompt building logic.
 * 
 * Responsible for constructing system prompts from character, user profile,
 * and other context. Can be extended to support reading from markdown files,
 * templates, or other sources in the future.
 */

import type { Character, PromptLanguage, UserProfile } from "../index.js";
import type { ConversationActor } from "../stores/character/conversationActor.js";
import { getPromptBlocks } from "./localizedPromptBlocks.js";
import { buildActorAliases } from "./actorAlias.js";

/**
 * A single message in the rendered prompt, using a unified role vocabulary.
 * Each ModelClient adapter maps this to its SDK's own message format.
 */
export type RenderedMessage = {
    role: "system" | "user" | "assistant";
    content: string;
};

/**
 * Input to buildSystemMessages.
 */
export interface BuildSystemMessagesInput {
    character: Character | null;
    userProfile: UserProfile | null;
    /** Active (leftAt=null) actors in the current conversation. */
    actors?: ConversationActor[] | null;
    relationshipState?: string | null;
    memories?: string[] | null;
    language?: PromptLanguage;
}

/**
 * Resolve the effective prompt language based on priority:
 * 1. Explicitly passed language parameter
 * 2. Character's language preference
 * 3. Default to "zh-CN"
 */
function resolvePromptLanguage(input: BuildSystemMessagesInput): PromptLanguage {
    if (input.language) return input.language;
    if (input.character?.language) return input.character.language;
    return "zh-CN";
}

function parseProfileSnapshot(profileSnapshotJson: string | null): Record<string, unknown> | null {
    if (!profileSnapshotJson) return null;
    try {
        const parsed = JSON.parse(profileSnapshotJson);
        if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
            return parsed as Record<string, unknown>;
        }
    } catch {
        // Ignore malformed snapshot JSON and fall back to other sources.
    }
    return null;
}

function stringifySnapshotValue(value: unknown): string {
    if (value === undefined || value === null || value === "") return "";
    if (Array.isArray(value)) return value.map(item => String(item)).join("，");
    if (typeof value === "object") return JSON.stringify(value);
    return String(value);
}

function extractLoggedUserInfo(
    actor: ConversationActor,
    snapshot: Record<string, unknown> | null,
    userProfile: UserProfile | null,
): string {
    const keys = ["bio", "description", "background"];
    for (const key of keys) {
        const text = stringifySnapshotValue(snapshot?.[key]);
        if (text) return text;
    }

    if (
        actor.userProfileId
        && userProfile
        && userProfile.userId === actor.userProfileId
        && userProfile.bio.trim()
    ) {
        return userProfile.bio.trim();
    }

    return "";
}

function extractActorInfo(
    actor: ConversationActor,
    snapshot: Record<string, unknown> | null,
    userProfile: UserProfile | null,
): string {
    if (actor.sourceType === "logged_user") {
        return extractLoggedUserInfo(actor, snapshot, userProfile);
    }

    const keys = ["description", "background", "bio"];
    for (const key of keys) {
        const text = stringifySnapshotValue(snapshot?.[key]);
        if (text) return text;
    }

    return "";
}

/**
 * Render the active actor list into a text block.
 */
function renderActors(actors: ConversationActor[] | null | undefined, userProfile: UserProfile | null): string {
    if (!actors || actors.length === 0) return "";
    const { aliases } = buildActorAliases(actors);
    const actorById = new Map<string, ConversationActor>(actors.map(actor => [actor.id, actor]));

    return aliases.map(alias => {
        const p = actorById.get(alias.actorId);
        if (!p) return `${alias.token}（other / local_actor）`;

        const lines: string[] = [`${alias.token}（${p.role} / ${p.sourceType}）`];
        const snapshot = parseProfileSnapshot(p.profileSnapshotJson);
        const info = extractActorInfo(p, snapshot, userProfile);
        if (info) {
            lines.push(`  人物信息：${info}`);
        }

        return lines.join("\n");
    }).join("\n\n");
}

/**
 * Render memories into a text block.
 */
function renderMemories(memories: string[] | null | undefined): string {
    if (!memories || memories.length === 0) return "";
    return memories.join("\n\n");
}

/**
 * Build a section with title and content.
 * Returns empty string if content is empty.
 */
function buildSection(title: string, content: string): string {
    if (!content) return "";
    return `${title}\n${content}`;
}

/**
 * Build a complete system prompt from components.
 * Sections with empty content are omitted.
 */
function buildSystemPrompt(input: BuildSystemMessagesInput, language: PromptLanguage): string {
    const blocks = getPromptBlocks(language);
    const sections: string[] = [];

    // Character persona prompt
    if (input.character?.name) {
        sections.push(buildSection(blocks.sectionLabels.characterName, input.character.name));
    }
    if (input.character?.description) {
        sections.push(buildSection(blocks.sectionLabels.characterDescription, input.character.description));
    }
    if (input.character?.personaPrompt) {
        sections.push(buildSection(blocks.sectionLabels.characterPersona, input.character.personaPrompt));
    }

    // Active conversation actors
    const actorsContent = renderActors(input.actors, input.userProfile);
    if (actorsContent) {
        sections.push(buildSection(blocks.sectionLabels.conversationActors, actorsContent));
    }

    // Relationship state (if provided)
    if (input.relationshipState) {
        sections.push(buildSection(blocks.sectionLabels.relationshipState, input.relationshipState));
    }

    // Memories (if provided)
    const memoriesContent = renderMemories(input.memories);
    if (memoriesContent) {
        sections.push(buildSection(blocks.sectionLabels.memories, memoriesContent));
    }

    // Base rules
    if (blocks.baseRules) {
        sections.push(buildSection(blocks.sectionLabels.rules, blocks.baseRules));
    }

    return sections.join(blocks.sectionDivider);
}

/**
 * Build system messages for the prompt context.
 * Returns an array with a single system message if content exists.
 */
export function buildSystemMessages(input: BuildSystemMessagesInput): RenderedMessage[] {
    const language = resolvePromptLanguage(input);
    const systemPrompt = buildSystemPrompt(input, language);

    if (!systemPrompt) return [];

    return [
        {
            role: "system",
            content: systemPrompt,
        },
    ];
}
