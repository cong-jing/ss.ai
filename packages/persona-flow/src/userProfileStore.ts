import type { UserProfile } from "./userProfile.js";

export interface UserProfileStore {
    getUserProfile(userId: string): Promise<UserProfile | null>;
    upsertUserProfile(profile: UserProfile): Promise<void>;
}
