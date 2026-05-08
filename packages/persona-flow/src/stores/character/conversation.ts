/**
 * A chat conversation scoped to a (userId, characterId) pair.
 * Primary key: id.
 */
export type Conversation = {
    id: string;
    userId: string;
    characterId: string;
    /** Optional human-readable title (null = untitled). */
    title: string | null;
    createdAt: string;
    updatedAt: string;
};
