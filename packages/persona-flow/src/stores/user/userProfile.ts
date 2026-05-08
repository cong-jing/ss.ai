export type UserProfile = {
    userId: string;
    name: string;
    preferredAddress?: string | null;
    bio: string;
    metadata: Record<string, unknown>;
    createdAt: string;
    updatedAt: string;
};
