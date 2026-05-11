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
import type { ActorTemplates } from "./localizedPromptBlocks.js";

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

const DEFAULT_ACTOR_TEMPLATES: ActorTemplates = {
    actorLine: "{{alias}}（{{role}} / {{sourceType}}）",
    actorInfoLine: "  人物信息：{{info}}",
    selfIdentityLine: "  你所扮演的角色是{{name}}。",
    selfDescriptionLine: "  角色描述：{{description}}",
    selfPersonaLine: "  角色人设：{{personaPrompt}}",
};

function resolveActorTemplates(partial?: Partial<ActorTemplates>): ActorTemplates {
    return {
        actorLine: partial?.actorLine || DEFAULT_ACTOR_TEMPLATES.actorLine,
        actorInfoLine: partial?.actorInfoLine || DEFAULT_ACTOR_TEMPLATES.actorInfoLine,
        selfIdentityLine: partial?.selfIdentityLine || DEFAULT_ACTOR_TEMPLATES.selfIdentityLine,
        selfDescriptionLine: partial?.selfDescriptionLine || DEFAULT_ACTOR_TEMPLATES.selfDescriptionLine,
        selfPersonaLine: partial?.selfPersonaLine || DEFAULT_ACTOR_TEMPLATES.selfPersonaLine,
    };
}

function renderTemplate(template: string, vars: Record<string, string>): string {
    return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => vars[key] ?? "");
}

function renderSelfRoleIntro(
    character: Character | null,
    actors: ConversationActor[] | null | undefined,
    templates: ActorTemplates,
): string {
    const selfActor = actors?.find(actor => actor.role === "self") ?? null;
    const lines: string[] = [];

    const selfName = character?.displayName || character?.name || selfActor?.displayName || "";
    if (selfName) {
        lines.push(renderTemplate(templates.selfIdentityLine, { name: selfName }));
    }
    if (character?.description) {
        lines.push(renderTemplate(templates.selfDescriptionLine, { description: character.description }));
    }
    if (character?.personaPrompt) {
        lines.push(renderTemplate(templates.selfPersonaLine, { personaPrompt: character.personaPrompt }));
    }

    return lines.join("\n");
}

/**
 * Render the active actor list into a text block.
 */
function renderActors(
    actors: ConversationActor[] | null | undefined,
    userProfile: UserProfile | null,
    character: Character | null,
    templates: ActorTemplates,
): string {
    if (!actors || actors.length === 0) return "";
    const selfActor = actors.find(actor => actor.role === "self") ?? null;
    const preferredSelfName = character?.displayName || character?.name;
    const aliasOverrides = new Map<string, string>();
    if (selfActor && preferredSelfName) {
        aliasOverrides.set(selfActor.id, preferredSelfName);
    }

    const { aliases } = buildActorAliases(actors, {
        displayNameOverridesByActorId: aliasOverrides,
    });
    const actorById = new Map<string, ConversationActor>(actors.map(actor => [actor.id, actor]));

    return aliases.map(alias => {
        const p = actorById.get(alias.actorId);
        if (!p) {
            return renderTemplate(templates.actorLine, {
                alias: alias.token,
                role: "other",
                sourceType: "local_actor",
            });
        }

        const lines: string[] = [renderTemplate(templates.actorLine, {
            alias: alias.token,
            role: p.role,
            sourceType: p.sourceType,
        })];

        if (p.role === "self") {
            const selfRoleIntro = renderSelfRoleIntro(character, actors, templates);
            if (selfRoleIntro) {
                lines.push(selfRoleIntro);
            }
        }

        const snapshot = parseProfileSnapshot(p.profileSnapshotJson);
        const info = extractActorInfo(p, snapshot, userProfile);
        if (info) {
            lines.push(renderTemplate(templates.actorInfoLine, { info }));
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
    const actorTemplates = resolveActorTemplates(blocks.actorTemplates);
    const sections: string[] = [];

    // Active conversation actors
    const actorsContent = renderActors(input.actors, input.userProfile, input.character, actorTemplates);
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
