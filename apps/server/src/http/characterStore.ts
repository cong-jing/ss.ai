import fs from "node:fs";
import path from "node:path";
import type { Character } from "@ss-ai/contracts";

interface CharacterStoreData {
    characters: Character[];
}

const DEFAULT_DATA: CharacterStoreData = { characters: [] };

/**
 * File-backed store for the character list.
 *
 * Persists to `characters.json` inside the userDataDir.
 * All methods are synchronous — consistent with the rest of the JSON file stores
 * in this project.
 */
export class CharacterStore {
    private readonly filePath: string;

    constructor(userDataDir: string) {
        this.filePath = path.join(userDataDir, "characters.json");
        fs.mkdirSync(userDataDir, { recursive: true });
        if (!fs.existsSync(this.filePath)) {
            this.writeData(DEFAULT_DATA);
        }
    }

    // ── Private helpers ──────────────────────────────────────────────────────

    private readData(): CharacterStoreData {
        try {
            const raw = fs.readFileSync(this.filePath, "utf-8");
            const parsed = JSON.parse(raw) as Partial<CharacterStoreData>;
            return { characters: Array.isArray(parsed.characters) ? parsed.characters : [] };
        } catch {
            return { ...DEFAULT_DATA };
        }
    }

    private writeData(data: CharacterStoreData): void {
        fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2), "utf-8");
    }

    // ── Public API ───────────────────────────────────────────────────────────

    list(): Character[] {
        return this.readData().characters;
    }

    get(id: string): Character | undefined {
        return this.readData().characters.find(c => c.id === id);
    }

    create(name: string, description = ""): Character {
        const data = this.readData();
        const now = new Date().toISOString();
        const character: Character = {
            id: crypto.randomUUID(),
            name: name.trim(),
            description: description.trim(),
            createdAt: now,
            updatedAt: now,
        };
        data.characters.push(character);
        this.writeData(data);
        return character;
    }

    update(id: string, patch: { name?: string; description?: string }): Character | undefined {
        const data = this.readData();
        const idx = data.characters.findIndex(c => c.id === id);
        if (idx === -1) return undefined;

        const existing = data.characters[idx];
        const updated: Character = {
            ...existing,
            name: typeof patch.name === "string" ? patch.name.trim() : existing.name,
            description: typeof patch.description === "string" ? patch.description.trim() : existing.description,
            updatedAt: new Date().toISOString(),
        };
        data.characters[idx] = updated;
        this.writeData(data);
        return updated;
    }

    delete(id: string): boolean {
        const data = this.readData();
        const before = data.characters.length;
        data.characters = data.characters.filter(c => c.id !== id);
        if (data.characters.length === before) return false;
        this.writeData(data);
        return true;
    }
}
