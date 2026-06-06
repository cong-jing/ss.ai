import type { Message } from "./message.js";
import type { UserCharacterState } from "../character/userCharacterState.js";

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
    appendAssistantTurn(input: {
        message: Message;
        events: NonNullable<Message["turnEvents"]>;
    }): Promise<void>;
    getRecentMessages(input: {
        /** @deprecated userId is no longer stored on messages; retained for call-site backwards compat only. */
        userId?: string;
        conversationId: string;
        limit: number;
    }): Promise<Message[]>;
    deleteMessage(input: {
        conversationId: string;
        messageId: string;
    }): Promise<void>;

    // ── Per-character conversation state ──────────────────────────────────────
    getCharacterState(input: { userId: string; characterId: string }): Promise<UserCharacterState | null>;
    upsertCharacterState(state: UserCharacterState): Promise<void>;
}
