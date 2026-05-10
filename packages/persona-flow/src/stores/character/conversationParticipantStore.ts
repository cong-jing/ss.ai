import type {
    ConversationParticipant,
    ConversationParticipantRole,
    ConversationParticipantSourceType,
} from "./conversationParticipant.js";

/**
 * Input for adding a participant to a conversation.
 */
export interface AddConversationParticipantInput {
    conversationId: string;
    role: ConversationParticipantRole;
    sourceType: ConversationParticipantSourceType;
    displayName: string;
    userProfileId?: string | null;
    characterId?: string | null;
    profileSnapshotJson?: string | null;
}

/**
 * Input for updating a conversation participant.
 */
export interface UpdateConversationParticipantInput {
    id: string;
    displayName?: string;
    profileSnapshotJson?: string | null;
    leftAt?: string | null;
}

/**
 * Persistence interface for ConversationParticipant records.
 */
export interface ConversationParticipantStore {
    /**
     * Look up a participant by its ID.
     */
    getParticipantById(id: string): Promise<ConversationParticipant | null>;

    /**
     * List all participants of a conversation.
     * Pass activeOnly: true to exclude participants that have left (leftAt != null).
     */
    listConversationParticipants(input: {
        conversationId: string;
        activeOnly?: boolean;
    }): Promise<ConversationParticipant[]>;

    /**
     * Append a new participant to a conversation and return the created record.
     */
    addConversationParticipant(input: AddConversationParticipantInput): Promise<ConversationParticipant>;

    /**
     * Update display name, profile snapshot, or left status of a participant.
     */
    updateConversationParticipant(input: UpdateConversationParticipantInput): Promise<void>;

    /**
     * Internal: directly insert a pre-built participant record.
     * Used by ConversationStore when auto-creating self/system participants.
     */
    createParticipant(participant: ConversationParticipant): Promise<void>;
}
