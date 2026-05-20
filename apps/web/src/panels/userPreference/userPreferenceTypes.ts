import type { ModelCallPurpose } from "@ss-ai/contracts";

export interface ProviderState {
    provider: string;
    /** true = already stored on server */
    apiKeySet: boolean;
    /** editing state on frontend — null means not editing */
    apiKeyInput: string | null;
    availableModels: string[];
    /** per-provider UI state */
    isSavingKey: boolean;
    isTestingKey: boolean;
    isLoadingModels: boolean;
    testResult: "none" | "ok" | "fail";
    testMessage: string;
}

export type ModelAssignmentState = {
    purpose: ModelCallPurpose;
    provider: string;
    model: string;
};
