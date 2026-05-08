import type { Conversation } from "./conversation.js";

/**
 * Persistence interface for Conversation records.
 * All queries are scoped to a userId so each user's conversations are isolated.
 * Concrete implementations live in adapter packages (e.g. persona-flow-sqlite).
 */
export interface ConversationStore {
    /**
     * List all conversations for a user + character, ordered by createdAt DESC.
     */
    listConversations(input: { userId: string; characterId: string }): Promise<Conversation[]>;

    /**
     * Fetch a single conversation by id, scoped to a user.
     * Returns null when not found.
     */
    getConversationById(input: { userId: string; conversationId: string }): Promise<Conversation | null>;

    /**
     * Insert a new conversation.
     * The caller is responsible for setting id, createdAt, and updatedAt.
     */
    createConversation(conversation: Conversation): Promise<void>;

    /**
     * Delete a conversation record and all its associated messages.
     */
    deleteConversation(input: { userId: string; conversationId: string }): Promise<void>;
}
