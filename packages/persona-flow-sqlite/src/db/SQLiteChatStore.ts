import type { ChatStore } from "@ss-ai/persona-flow";
import type { DrizzleDb } from "./openDatabase.js";
import { SQLiteMessageStore } from "./SQLiteMessageStore.js";
import { SQLiteUserCharacterStateStore } from "./SQLiteUserCharacterStateStore.js";
import type { Message, UserCharacterState } from "@ss-ai/persona-flow";

/**
 * SQLite implementation of ChatStore.
 *
 * Delegates to SQLiteMessageStore and SQLiteUserCharacterStateStore internally.
 * Future chat-related tables (conversations, summaries, tags, embeddings, etc.)
 * can be added here without exposing them as separate stores.
 */
export class SQLiteChatStore implements ChatStore {
    private readonly messages: SQLiteMessageStore;
    private readonly characterStates: SQLiteUserCharacterStateStore;

    constructor(db: DrizzleDb) {
        this.messages = new SQLiteMessageStore(db);
        this.characterStates = new SQLiteUserCharacterStateStore(db);
    }

    appendMessage(message: Message): Promise<void> {
        return this.messages.appendMessage(message);
    }

    getRecentMessages(input: { userId: string; conversationId: string; limit: number }): Promise<Message[]> {
        return this.messages.getRecentMessages(input);
    }

    getCharacterState(input: { userId: string; characterId: string }): Promise<UserCharacterState | null> {
        return this.characterStates.getState(input);
    }

    upsertCharacterState(state: UserCharacterState): Promise<void> {
        return this.characterStates.upsertState(state);
    }
}
