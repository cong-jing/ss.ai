import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_INTERACTION_MODE, INTERACTION_MODES, type CharacterTemplate, type InteractionMode, type PromptLanguage } from "@ss-ai/contracts";

type TemplateFile = {
    id: string;
    language: PromptLanguage;
    name: string;
    displayName?: string | null;
    description: string;
    personaPrompt: string;
    greetingMessage?: string | null;
    interactionMode?: string;
    sortOrder?: number;
};

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const templatesDir = path.join(moduleDir, "templates");
const supportedLanguages: readonly PromptLanguage[] = ["zh-CN", "en-US", "ja-JP"];
const interactionModes = new Set<string>(INTERACTION_MODES);
let cachedTemplates: TemplateFile[] | null = null;

function readTemplateFiles(): TemplateFile[] {
    if (cachedTemplates) return cachedTemplates;
    if (!fs.existsSync(templatesDir)) return [];
    const entries = fs.readdirSync(templatesDir, { withFileTypes: true });
    const files = entries
        .filter(entry => entry.isFile() && entry.name.endsWith(".json"))
        .map(entry => path.join(templatesDir, entry.name))
        .sort();
    const templates: TemplateFile[] = [];
    for (const filePath of files) {
        try {
            const raw = fs.readFileSync(filePath, "utf8");
            const parsed = JSON.parse(raw) as TemplateFile;
            templates.push(parsed);
        } catch (error) {
            console.warn(`[character-templates] Skipping invalid template file: ${filePath}`, {
                message: error instanceof Error ? error.message : String(error),
            });
        }
    }
    cachedTemplates = templates;
    return cachedTemplates;
}

export function listCharacterTemplates(languageInput: unknown): CharacterTemplate[] {
    if (!isPromptLanguage(languageInput)) return [];
    const language = languageInput;
    const templates = readTemplateFiles();
    return templates
        .filter(template => template.language === language)
        .sort((a, b) => (a.sortOrder ?? Number.MAX_SAFE_INTEGER) - (b.sortOrder ?? Number.MAX_SAFE_INTEGER))
        .map((template): CharacterTemplate => {
            const interactionMode: InteractionMode = typeof template.interactionMode === "string" && interactionModes.has(template.interactionMode)
                ? template.interactionMode as InteractionMode
                : DEFAULT_INTERACTION_MODE;
            return {
                id: template.id,
                name: template.name,
                displayName: template.displayName ?? null,
                description: template.description,
                personaPrompt: template.personaPrompt,
                greetingMessage: template.greetingMessage ?? null,
                interactionMode,
                language: template.language,
            };
        });
}

export function isPromptLanguage(value: unknown): value is PromptLanguage {
    return typeof value === "string" && (supportedLanguages as readonly string[]).includes(value);
}
