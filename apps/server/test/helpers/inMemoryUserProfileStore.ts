import type { UserProfile, UserProfileStore } from "@ss-ai/persona-flow";

export class InMemoryUserProfileStore implements UserProfileStore {
    private readonly store = new Map<string, UserProfile>();

    async getUserProfile(userId: string): Promise<UserProfile | null> {
        return this.store.get(userId) ?? null;
    }

    async upsertUserProfile(profile: UserProfile): Promise<void> {
        this.store.set(profile.userId, { ...profile });
    }
}
