import type { ChatStore } from "@ss-ai/persona-flow";
import type { DrizzleDb } from "./openDatabase.js";
import { SQLiteMessageStore } from "./SQLiteMessageStore.js";
import { SQLiteUserCharacterStateStore } from "./SQLiteUserCharacterStateStore.js";
import type { Message, UserCharacterState } from "@ss-ai/persona-flow";
import type { CharacterDbRouter } from "./CharacterDbRouter.js";

/**
 * SQLite implementation of ChatStore.
 *
 * Covers messages and per-character active-conversation state.
 * Conversation lifecycle (create / list / delete) is handled by SQLiteConversationStore.
 */
export class SQLiteChatStore implements ChatStore {
    private readonly msgs: SQLiteMessageStore;
    private readonly characterStates: SQLiteUserCharacterStateStore;

    constructor(private readonly db: DrizzleDb, characterDbRouter?: CharacterDbRouter) {
        this.msgs = new SQLiteMessageStore(db, characterDbRouter);
        this.characterStates = new SQLiteUserCharacterStateStore(db, characterDbRouter);
    }

    // ── Messages ──────────────────────────────────────────────────────────────

    appendMessage(message: Message): Promise<void> {
        return this.msgs.appendMessage(message);
    }

    getRecentMessages(input: { userId?: string; conversationId: string; limit: number }): Promise<Message[]> {
        return this.msgs.getRecentMessages(input);
    }

    deleteMessage(input: { conversationId: string; messageId: string }): Promise<void> {
        return this.msgs.deleteMessage(input);
    }

    // ── Per-character conversation state ──────────────────────────────────────

    getCharacterState(input: { userId: string; characterId: string }): Promise<UserCharacterState | null> {
        return this.characterStates.getState(input);
    }

    upsertCharacterState(state: UserCharacterState): Promise<void> {
        return this.characterStates.upsertState(state);
    }
}
