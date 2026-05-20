import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { conversations } from "./schema.js";
import type { DbLog, DrizzleDb, OpenDatabaseResult } from "./openDatabase.js";
import { openCharacterDatabase } from "./openCharacterDatabase.js";

type CharacterDbHandle = OpenDatabaseResult;

function sanitizeSegment(value: string): string {
    return value.replace(/[^a-zA-Z0-9._-]/g, "_");
}

export class CharacterDbRouter {
    private readonly handles = new Map<string, CharacterDbHandle>();

    constructor(
        private readonly coreDb: DrizzleDb,
        private readonly characterDbDir: string,
        private readonly dblog?: DbLog,
    ) {
        fs.mkdirSync(characterDbDir, { recursive: true });
    }

    getDbForCharacter(input: { userId: string; characterId: string }): DrizzleDb {
        return this.getHandle(input).db;
    }

    async getDbForConversation(input: { conversationId: string }): Promise<DrizzleDb> {
        const rows = await this.coreDb
            .select({ userId: conversations.userId, characterId: conversations.characterId })
            .from(conversations)
            .where(eq(conversations.id, input.conversationId))
            .limit(1);

        if (rows.length === 0) {
            throw new Error(`Conversation not found: ${input.conversationId}`);
        }

        return this.getDbForCharacter({ userId: rows[0].userId, characterId: rows[0].characterId });
    }

    closeAll(): void {
        for (const handle of this.handles.values()) {
            handle.sqlite.close();
        }
        this.handles.clear();
    }

    private getHandle(input: { userId: string; characterId: string }): CharacterDbHandle {
        const key = `${input.userId}::${input.characterId}`;
        const cached = this.handles.get(key);
        if (cached) {
            return cached;
        }

        const userId = sanitizeSegment(input.userId);
        const characterId = sanitizeSegment(input.characterId);
        const characterDir = path.join(this.characterDbDir, userId);
        fs.mkdirSync(characterDir, { recursive: true });
        const dbPath = path.join(characterDir, `${characterId}.db`);
        const opened = openCharacterDatabase(dbPath, this.dblog);
        this.handles.set(key, opened);
        return opened;
    }
}
