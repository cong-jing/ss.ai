/**
 * The role of a participant within a conversation.
 *
 * - self:   The current AI character (conversation.characterId).
 * - system: System / narrator / system directive source.
 * - other:  All other speakers: logged users, local actors, guest AI characters.
 */
export type ConversationParticipantRole = "self" | "system" | "other";

/**
 * The origin type of a participant.
 *
 * - ai_character: An AI character. characterId is set.
 * - system:       The system participant.
 * - logged_user:  A logged-in user appended by the frontend/server. userProfileId is set.
 * - local_actor:  A transient character that only exists within this conversation.
 */
export type ConversationParticipantSourceType =
    | "ai_character"
    | "system"
    | "logged_user"
    | "local_actor";

/**
 * A participant in a conversation.
 * Every speaker of a Message is identified by a ConversationParticipant.
 */
export type ConversationParticipant = {
    /** Unique participant ID (uuid). */
    id: string;
    /** The conversation this participant belongs to. */
    conversationId: string;
    /** Role within the conversation. */
    role: ConversationParticipantRole;
    /** Origin type. */
    sourceType: ConversationParticipantSourceType;
    /** Display name shown to the AI and in the UI. */
    displayName: string;
    /** Global user profile ID, set for logged_user participants. */
    userProfileId: string | null;
    /** Character ID, set for ai_character participants. */
    characterId: string | null;
    /**
     * JSON snapshot of the participant's profile for use in prompts.
     * For logged_user: user profile snapshot.
     * For local_actor: character definition.
     * For self/system: usually null.
     */
    profileSnapshotJson: string | null;
    /**
     * When set, this participant has left the conversation.
     * Left participants are excluded from active participant queries.
     */
    leftAt: string | null;
    createdAt: string;
    updatedAt: string;
};
