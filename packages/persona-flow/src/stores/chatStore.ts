import type { Message } from "./message.js";
import type { UserCharacterState } from "./userCharacterState.js";

/**
 * Store for chat messages and per-character active-conversation state.
 *
 * Conversation lifecycle (create / list / delete) lives in ConversationStore.
 * Internal SQLite tables (summaries, tags, embeddings, etc.)
 * are implementation details of the concrete adapter.
 */
export interface ChatStore {
    // ── Messages ──────────────────────────────────────────────────────────────
    appendMessage(message: Message): Promise<void>;
    getRecentMessages(input: {
        userId: string;
        conversationId: string;
        limit: number;
    }): Promise<Message[]>;

    // ── Per-character conversation state ──────────────────────────────────────
    getCharacterState(input: { userId: string; characterId: string }): Promise<UserCharacterState | null>;
    upsertCharacterState(state: UserCharacterState): Promise<void>;
}
