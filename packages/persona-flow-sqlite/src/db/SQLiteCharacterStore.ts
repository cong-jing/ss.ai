import { eq, desc, inArray } from "drizzle-orm";
import { characters, type CharacterRow, type NewCharacterRow } from "./schema.js";
import type { DrizzleDb } from "./openDatabase.js";
import type { Character, CharacterStatus, CharacterStore } from "@ss-ai/persona-flow";

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
        name: row.name,
        displayName: row.displayName ?? null,
        description: row.description ?? null,
        personaPrompt: row.personaPrompt,
        greetingMessage: row.greetingMessage ?? null,
        avatarUrl: row.avatarUrl ?? null,
        modelConfig: safeParseJsonObject(row.modelConfigJson),
        generationConfig: safeParseJsonObject(row.generationConfigJson),
        memoryConfig: safeParseJsonObject(row.memoryConfigJson),
        status: row.status as CharacterStatus,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
    };
}

function characterToInsertRow(character: Character): NewCharacterRow {
    return {
        id: character.id,
        name: character.name,
        displayName: character.displayName ?? null,
        description: character.description ?? null,
        personaPrompt: character.personaPrompt,
        greetingMessage: character.greetingMessage ?? null,
        avatarUrl: character.avatarUrl ?? null,
        modelConfigJson: JSON.stringify(character.modelConfig),
        generationConfigJson: JSON.stringify(character.generationConfig),
        memoryConfigJson: JSON.stringify(character.memoryConfig),
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

    async getCharacterById(id: string): Promise<Character | null> {
        const rows = await this.db
            .select()
            .from(characters)
            .where(eq(characters.id, id))
            .limit(1);

        return rows.length > 0 ? rowToCharacter(rows[0]) : null;
    }

    async listCharacters(input?: {
        status?: CharacterStatus;
        limit?: number;
    }): Promise<Character[]> {
        const limit = input?.limit ?? 50;
        const query = this.db.select().from(characters);

        const rows = input?.status
            ? await query.where(eq(characters.status, input.status)).orderBy(desc(characters.updatedAt)).limit(limit)
            : await query.where(inArray(characters.status, ["active", "archived"])).orderBy(desc(characters.updatedAt)).limit(limit);

        return rows.map(rowToCharacter);
    }

    async updateCharacter(input: {
        id: string;
        patch: Partial<Omit<Character, "id" | "createdAt">>;
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
        if (patch.generationConfig !== undefined) values.generationConfigJson = JSON.stringify(patch.generationConfig);
        if (patch.memoryConfig !== undefined) values.memoryConfigJson = JSON.stringify(patch.memoryConfig);
        if (patch.status !== undefined) values.status = patch.status;
        if (patch.updatedAt !== undefined) values.updatedAt = patch.updatedAt;

        await this.db
            .update(characters)
            .set(values)
            .where(eq(characters.id, input.id));
    }

    async archiveCharacter(input: { id: string; updatedAt: string }): Promise<void> {
        await this.db
            .update(characters)
            .set({ status: "archived", updatedAt: input.updatedAt })
            .where(eq(characters.id, input.id));
    }
}
