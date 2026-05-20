import { and, eq, desc, inArray } from "drizzle-orm";
import { characters, type CharacterRow, type NewCharacterRow } from "./schema.js";
import type { DrizzleDb } from "./openDatabase.js";
import { DEFAULT_INTERACTION_MODE } from "@ss-ai/contracts";
import type { Character, CharacterStatus, PromptLanguage, CharacterStore } from "@ss-ai/persona-flow";

// ── helpers ───────────────────────────────────────────────────────────────────

function safeParseJsonObject(value: string | null | undefined): Record<string, unknown> {
    if (!value) return {};
    try {
        const parsed = JSON.parse(value);
        if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
            return parsed as Record<string, unknown>;
        }
        return {};
    } catch {
        return {};
    }
}

function rowToCharacter(row: CharacterRow): Character {
    return {
        id: row.id,
        userId: row.userId,
        name: row.name,
        displayName: row.displayName ?? null,
        description: row.description ?? null,
        personaPrompt: row.personaPrompt,
        greetingMessage: row.greetingMessage ?? null,
        avatarUrl: row.avatarUrl ?? null,
        modelConfig: safeParseJsonObject(row.modelConfigJson),
        interactionMode: (row.interactionMode as Character["interactionMode"]) ?? DEFAULT_INTERACTION_MODE,
        generationConfig: safeParseJsonObject(row.generationConfigJson),
        memoryConfig: safeParseJsonObject(row.memoryConfigJson),
        language: (row.language as PromptLanguage | null) ?? null,
        status: row.status as CharacterStatus,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
    };
}

function characterToInsertRow(character: Character): NewCharacterRow {
    return {
        id: character.id,
        userId: character.userId,
        name: character.name,
        displayName: character.displayName ?? null,
        description: character.description ?? null,
        personaPrompt: character.personaPrompt,
        greetingMessage: character.greetingMessage ?? null,
        avatarUrl: character.avatarUrl ?? null,
        modelConfigJson: JSON.stringify(character.modelConfig),
        interactionMode: character.interactionMode ?? DEFAULT_INTERACTION_MODE,
        generationConfigJson: JSON.stringify(character.generationConfig),
        memoryConfigJson: JSON.stringify(character.memoryConfig),
        language: character.language ?? "zh-CN",
        status: character.status,
        createdAt: character.createdAt,
        updatedAt: character.updatedAt,
    };
}

// ── store implementation ───────────────────────────────────────────────────────

export class SQLiteCharacterStore implements CharacterStore {
    constructor(private readonly db: DrizzleDb) { }

    async createCharacter(character: Character): Promise<void> {
        await this.db.insert(characters).values(characterToInsertRow(character));
    }

    async getCharacterById(input: { userId: string; characterId: string }): Promise<Character | null> {
        const rows = await this.db
            .select()
            .from(characters)
            .where(and(
                eq(characters.userId, input.userId),
                eq(characters.id, input.characterId),
            ))
            .limit(1);

        return rows.length > 0 ? rowToCharacter(rows[0]) : null;
    }

    async listCharacters(input: {
        userId: string;
        status?: CharacterStatus;
        limit?: number;
    }): Promise<Character[]> {
        const limit = input.limit ?? 50;
        const base = this.db.select().from(characters);

        const rows = input.status
            ? await base
                .where(and(eq(characters.userId, input.userId), eq(characters.status, input.status)))
                .orderBy(desc(characters.updatedAt))
                .limit(limit)
            : await base
                .where(and(eq(characters.userId, input.userId), inArray(characters.status, ["active", "archived"])))
                .orderBy(desc(characters.updatedAt))
                .limit(limit);

        return rows.map(rowToCharacter);
    }

    async updateCharacter(input: {
        userId: string;
        characterId: string;
        patch: Partial<Omit<Character, "id" | "userId" | "createdAt">>;
    }): Promise<void> {
        const patch = input.patch;
        const values: Partial<NewCharacterRow> = {};

        if (patch.name !== undefined) values.name = patch.name;
        if (patch.displayName !== undefined) values.displayName = patch.displayName ?? null;
        if (patch.description !== undefined) values.description = patch.description ?? null;
        if (patch.personaPrompt !== undefined) values.personaPrompt = patch.personaPrompt;
        if (patch.greetingMessage !== undefined) values.greetingMessage = patch.greetingMessage ?? null;
        if (patch.avatarUrl !== undefined) values.avatarUrl = patch.avatarUrl ?? null;
        if (patch.modelConfig !== undefined) values.modelConfigJson = JSON.stringify(patch.modelConfig);
        if (patch.interactionMode !== undefined) values.interactionMode = patch.interactionMode ?? DEFAULT_INTERACTION_MODE;
        if (patch.generationConfig !== undefined) values.generationConfigJson = JSON.stringify(patch.generationConfig);
        if (patch.memoryConfig !== undefined) values.memoryConfigJson = JSON.stringify(patch.memoryConfig);
        if (patch.status !== undefined) values.status = patch.status;
        if (patch.updatedAt !== undefined) values.updatedAt = patch.updatedAt;

        await this.db
            .update(characters)
            .set(values)
            .where(and(
                eq(characters.userId, input.userId),
                eq(characters.id, input.characterId),
            ));
    }

    async archiveCharacter(input: { userId: string; characterId: string; updatedAt: string }): Promise<void> {
        await this.db
            .update(characters)
            .set({ status: "archived", updatedAt: input.updatedAt })
            .where(and(
                eq(characters.userId, input.userId),
                eq(characters.id, input.characterId),
            ));
    }
}
