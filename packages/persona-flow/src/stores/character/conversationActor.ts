/**
 * The role of an actor within a conversation.
 *
 * - self:   The current AI character (conversation.characterId).
 * - system: System / narrator / system directive source.
 * - other:  All other speakers: logged users, local actors, guest AI characters.
 */
export type ConversationActorRole = "self" | "system" | "other";

/**
 * The origin type of an actor.
 *
 * - ai_character: An AI character. characterId is set.
 * - system:       The system actor.
 * - logged_user:  A logged-in user appended by the frontend/server. userProfileId is set.
 * - local_actor:  A transient character that only exists within this conversation.
 */
export type ConversationActorSourceType =
    | "ai_character"
    | "system"
    | "logged_user"
    | "local_actor";

/**
 * An actor in a conversation.
 * Every speaker of a Message is identified by a ConversationActor.
 */
export type ConversationActor = {
    /** Unique actor ID (uuid). */
    id: string;
    /** The conversation this actor belongs to. */
    conversationId: string;
    /** Role within the conversation. */
    role: ConversationActorRole;
    /** Origin type. */
    sourceType: ConversationActorSourceType;
    /** Display name shown to the AI and in the UI. */
    displayName: string;
    /** Global user profile ID, set for logged_user actors. */
    userProfileId: string | null;
    /** Character ID, set for ai_character actors. */
    characterId: string | null;
    /**
     * JSON snapshot of the actor's profile for use in prompts.
     * For logged_user: user profile snapshot.
     * For local_actor: character definition.
     * For self/system: usually null.
     */
    profileSnapshotJson: string | null;
    /**
     * When set, this actor has left the conversation.
     * Left actors are excluded from active actor queries.
     */
    leftAt: string | null;
    createdAt: string;
    updatedAt: string;
};
