import type { ModelAssignmentMap } from "@ss-ai/contracts";

export type UserPreferences = {
    userId: string;
    currentCharacterId?: string | null;
    /** Map from model-call purpose to provider+model. */
    modelAssignments: ModelAssignmentMap;
    createdAt: string;
    updatedAt: string;
};
