/**
 * Localized prompt text blocks and templates.
 * Blocks are loaded from YAML files in data/prompts/<language>.yaml.
 * Add a new language by dropping a new YAML file — no code changes needed.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import { parse as parseYaml } from "yaml";
import type { PromptLanguage } from "../stores/character/character.js";

export interface SectionLabels {
    /**
     * Section label strings used to group prompt sections. Some labels may no
     * longer be referenced by code but are preserved for template tuning.
     * If you change these, ensure promptRenderer/systemPromptBuilder usage is
     * updated accordingly.
     */
    characterName: string;
    characterDescription: string;
    characterPersona: string;
    /** Optional explicit section for self role-playing instructions. */
    selfRoleIntro?: string;
    userProfile: string;
    conversationActors: string;
    relationshipState: string;
    memories: string;
    rules: string;
}

export interface FieldLabels {
    /**
     * Field labels are used when rendering short user/profile fields into
     * prompts. Some fields may be unused depending on the prompt layout.
     */
    userName: string;
    preferredAddress: string;
    userBio: string;
}

export interface ActorTemplates {
    /** Actor header line. Supported placeholders: {{alias}}, {{role}}, {{sourceType}}. */
    actorLine: string;
    /** Actor info line. Supported placeholder: {{info}}. */
    actorInfoLine: string;
    /** Self identity line. Supported placeholder: {{name}}. */
    selfIdentityLine: string;
    /** Self description line. Supported placeholder: {{description}}. */
    selfDescriptionLine: string;
    /** Self persona line. Supported placeholder: {{personaPrompt}}. */
    selfPersonaLine: string;
}

export interface LocalizedPromptBlock {
    sectionLabels: SectionLabels;
    fieldLabels: FieldLabels;
    actorTemplates?: ActorTemplates;
    baseRules: string;
    sectionDivider: string;
}

const __dir = dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = resolve(__dir, "../../data/prompts");

function loadLanguage(lang: string): LocalizedPromptBlock | null {
    try {
        const raw = readFileSync(resolve(PROMPTS_DIR, `${lang}.yaml`), "utf-8");
        return parseYaml(raw) as LocalizedPromptBlock;
    } catch {
        return null;
    }
}

// Eagerly load supported languages at module init so errors surface early.
const FALLBACK: PromptLanguage = "zh-CN";
const cache = new Map<PromptLanguage, LocalizedPromptBlock>();

function get(lang: PromptLanguage): LocalizedPromptBlock {
    if (cache.has(lang)) return cache.get(lang)!;
    const block = loadLanguage(lang);
    if (block) {
        cache.set(lang, block);
        return block;
    }
    // Fall back to zh-CN
    if (lang !== FALLBACK) return get(FALLBACK);
    throw new Error(`Prompt block file not found: ${PROMPTS_DIR}/${FALLBACK}.yaml`);
}

// Eagerly warm the fallback so a missing file throws at startup, not mid-request.
get(FALLBACK);

/** @deprecated Use getPromptBlocks() instead. */
export const localizedPromptBlocks = new Proxy({} as Record<PromptLanguage, LocalizedPromptBlock>, {
    get(_, lang: string) { return get(lang as PromptLanguage); },
});

/**
 * Get localized prompt blocks for the specified language.
 * Falls back to 'zh-CN' if the YAML file for the language is missing.
 */
export function getPromptBlocks(language?: PromptLanguage): LocalizedPromptBlock {
    return get(language ?? FALLBACK);
}
