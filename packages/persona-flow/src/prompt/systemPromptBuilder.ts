/**
 * System prompt building logic.
 * 
 * Responsible for constructing system prompts from character, user profile,
 * and other context. Can be extended to support reading from markdown files,
 * templates, or other sources in the future.
 */

import type { Character, PromptLanguage, UserProfile } from "../index.js";
import type { ConversationActor } from "../stores/character/conversationActor.js";
import { getPromptBlocks, type LocalizedPromptBlock } from "./localizedPromptBlocks.js";

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

/**
 * Render user profile into a text block using localized field labels.
 */
function renderUserProfile(userProfile: UserProfile | null, fieldLabels: LocalizedPromptBlock["fieldLabels"]): string {
    if (!userProfile) return "";

    const parts: string[] = [];

    if (userProfile.name) {
        parts.push(`${fieldLabels.userName}：${userProfile.name}`);
    }

    if (userProfile.preferredAddress) {
        parts.push(`${fieldLabels.preferredAddress}：${userProfile.preferredAddress}`);
    }

    if (userProfile.bio) {
        parts.push(`${fieldLabels.userBio}：${userProfile.bio}`);
    }

    return parts.join("\n");
}

/**
 * Render the active actor list into a text block.
 */
function renderActors(actors: ConversationActor[] | null | undefined): string {
    if (!actors || actors.length === 0) return "";
    return actors.map(p => {
        const lines: string[] = [`${p.displayName}（${p.role} / ${p.sourceType}）`];
        if (p.profileSnapshotJson) {
            try {
                const snapshot = JSON.parse(p.profileSnapshotJson);
                if (typeof snapshot === "object" && snapshot !== null) {
                    const record = snapshot as Record<string, unknown>;
                    const preferredKeys = [
                        "description",
                        "background",
                    ];

                    for (const key of preferredKeys) {
                        const value = record[key];
                        if (value === undefined || value === null || value === "") continue;
                        if (Array.isArray(value)) {
                            lines.push(`  ${key}：${value.join("，")}`);
                        } else if (typeof value === "object") {
                            lines.push(`  ${key}：${JSON.stringify(value)}`);
                        } else {
                            lines.push(`  ${key}：${String(value)}`);
                        }
                    }

                    for (const [k, v] of Object.entries(record)) {
                        if (preferredKeys.includes(k)) continue;
                        if (v === undefined || v === null || v === "") continue;
                        if (Array.isArray(v)) {
                            lines.push(`  ${k}：${v.join("，")}`);
                        } else if (typeof v === "object") {
                            lines.push(`  ${k}：${JSON.stringify(v)}`);
                        } else {
                            lines.push(`  ${k}：${String(v)}`);
                        }
                    }
                }
            } catch {
                lines.push(`  ${p.profileSnapshotJson}`);
            }
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

    // User profile
    const userProfileContent = renderUserProfile(input.userProfile, blocks.fieldLabels);
    if (userProfileContent) {
        sections.push(buildSection(blocks.sectionLabels.userProfile, userProfileContent));
    }

    // Active conversation actors
    const actorsContent = renderActors(input.actors);
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
