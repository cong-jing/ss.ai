import type { ModelAssignment, ModelCallPurpose } from "@ss-ai/contracts";
import type { UserPreferences } from "./userPreferences.js";

export interface UserPreferencesStore {
    getUserPreferences(userId: string): Promise<UserPreferences | null>;
    upsertUserPreferences(preferences: UserPreferences): Promise<void>;
    setCurrentCharacter(input: { userId: string; characterId: string | null; updatedAt: string }): Promise<void>;
    setModelAssignment(input: { userId: string; modelCallPurpose: ModelCallPurpose; assignment: ModelAssignment; updatedAt: string }): Promise<void>;
}
