import type { ApiKeySource, ModelAssignment, ModelAssignmentSource, ModelCallPurpose, ProviderAvailableModels } from "@ss-ai/contracts";

export interface ProviderState {
    provider: string;
    userApiKeySet: boolean;
    defaultApiKeySet: boolean;
    effectiveApiKeySource: ApiKeySource;
    defaultApiKeyWarning: string;
    apiKeyInput: string | null;
    availableModels: ProviderAvailableModels;
    isSavingKey: boolean;
    isTestingKey: boolean;
    isLoadingModels: boolean;
    testResult: "none" | "ok" | "fail";
    testMessage: string;
}

export type ModelAssignmentState = {
    purpose: ModelCallPurpose;
    userAssignment: ModelAssignment | null;
    defaultAssignment: ModelAssignment | null;
    effectiveAssignment: ModelAssignment | null;
    effectiveSource: ModelAssignmentSource;
    provider: string;
    model: string;
};
