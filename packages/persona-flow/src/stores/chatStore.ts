import type { Message } from "../message.js";
import type { UserCharacterState } from "./userCharacterState.js";

/**
 * Unified store for chat-related operations.
 *
 * Covers messages and per-character conversation state.
 * Internal SQLite tables (conversations, summaries, tags, embeddings, etc.)
 * are implementation details of the concrete adapter.
 * Only add methods here when exposing a new public business capability.
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
