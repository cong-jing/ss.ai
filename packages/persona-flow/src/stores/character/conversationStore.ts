import type { Conversation } from "./conversation.js";

/**
 * Returned by createConversation — the IDs of the two auto-created participants.
 */
export type CreateConversationResult = {
    /** participant.id of the self (AI) participant. */
    selfParticipantId: string;
    /** participant.id of the system participant. */
    systemParticipantId: string;
};

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
     * Insert a new conversation and auto-create two participants:
     * - self  (ai_character, role=self, displayName=selfDisplayName)
     * - system (role=system, displayName='系统')
     *
     * Returns the IDs of the two auto-created participants.
     */
    createConversation(
        conversation: Conversation,
        options: { selfDisplayName: string },
    ): Promise<CreateConversationResult>;

    /**
     * Delete a conversation record and all its associated messages and participants.
     */
    deleteConversation(input: { userId: string; conversationId: string }): Promise<void>;
}
