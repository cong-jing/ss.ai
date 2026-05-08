/**
 * Per-character state scoped to a user.
 * Primary key: (userId, characterId).
 */
export type UserCharacterState = {
    userId: string;
    characterId: string;
    /** The currently active conversationId for this character. */
    currentConversationId: string;
    createdAt: string;
    updatedAt: string;
};
