import type { UserPreferences, ModelSelection } from "./userPreferences.js";

export interface UserPreferencesStore {
    getUserPreferences(userId: string): Promise<UserPreferences | null>;
    upsertUserPreferences(preferences: UserPreferences): Promise<void>;
    setCurrentCharacter(input: { userId: string; characterId: string | null; updatedAt: string }): Promise<void>;
    setFunctionModel(input: { userId: string; functionName: string; selection: ModelSelection; updatedAt: string }): Promise<void>;
}
