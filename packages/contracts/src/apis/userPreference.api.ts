import { ApiDefine } from "../apiBase.js";
import type { ModelAssignment, ModelCallPurpose } from "../modelCallPurpose.js";

// --- Provider info ---

export type ApiKeySource = "user" | "default" | "missing";
export type ModelAssignmentSource = "user" | "default" | "missing";

/**
 * Models a provider exposes, split by capability category so the UI can
 * filter dropdown options per model-call purpose. Each category is always
 * present (possibly empty) to avoid optional-chaining noise downstream.
 */
export interface ProviderAvailableModels {
    chat: string[];
    embed: string[];
}

export interface ProviderStatus {
    provider: string;
    userApiKeySet: boolean;
    defaultApiKeySet: boolean;
    effectiveApiKeySource: ApiKeySource;
    defaultApiKeyWarning?: string;
    availableModels: ProviderAvailableModels;
}

// --- Model assignment ---

export interface ModelAssignmentStatus {
    userAssignment: ModelAssignment | null;
    defaultAssignment: ModelAssignment | null;
    effectiveAssignment: ModelAssignment | null;
    effectiveSource: ModelAssignmentSource;
}

export type UserModelAssignmentMap = Partial<Record<ModelCallPurpose, ModelAssignmentStatus>>;

// --- GET /v1/user-preference ---

export interface GetUserPreferenceResponse {
    providers: ProviderStatus[];
    modelAssignments: UserModelAssignmentMap;
}

// --- POST /v1/user-preference/api-key ---

export interface UpsertApiKeyRequest {
    provider: string;
    apiKey: string;
}

export interface UpsertApiKeyResponse {
    provider: string;
    apiKeySet: boolean;
    availableModels: ProviderAvailableModels;
}

// --- POST /v1/user-preference/api-key/delete ---

export interface DeleteApiKeyRequest {
    provider: string;
}

export interface DeleteApiKeyResponse {
    provider: string;
    apiKeySet: boolean;
    /**
     * Models still effectively available after the user key is removed.
     * Includes any static `availableModels` from server config (which do not
     * depend on the user key) so the UI can keep showing dropdown options
     * when a default API key or static list still applies. Empty when no
     * key (user or default) and no static list are configured.
     */
    availableModels: ProviderAvailableModels;
}

// --- POST /v1/user-preference/test-api-key ---

export interface TestApiKeyRequest {
    provider: string;
}

export interface TestApiKeyResponse {
    provider: string;
    ok: boolean;
    source: ApiKeySource;
    message?: string;
}

// --- POST /v1/user-preference/model-assignment ---

export interface UpsertModelAssignmentRequest {
    modelCallPurpose: ModelCallPurpose;
    provider: string;
    model: string;
}

export interface UpsertModelAssignmentResponse {
    modelAssignments: UserModelAssignmentMap;
}

// --- POST /v1/user-preference/list-models ---
//
// Live connectivity check + raw enumeration from the provider. The result is
// intentionally a flat list (no category split) because providers like Mistral
// return chat and embed models in the same response with no reliable category
// marker. Callers use this only for the "test API key" button and may show
// the raw list as supplemental info.

export interface ListModelsRequest {
    provider: string;
}

export interface ListModelsResponse {
    provider: string;
    models: string[];
}

export const ApiGetUserPreference = new ApiDefine<void, GetUserPreferenceResponse>("/v1/user-preference", "GET");
export const ApiUpsertApiKey = new ApiDefine<UpsertApiKeyRequest, UpsertApiKeyResponse>("/v1/user-preference/api-key", "POST");
export const ApiDeleteApiKey = new ApiDefine<DeleteApiKeyRequest, DeleteApiKeyResponse>("/v1/user-preference/api-key/delete", "POST");
export const ApiTestApiKey = new ApiDefine<TestApiKeyRequest, TestApiKeyResponse>("/v1/user-preference/test-api-key", "POST");
export const ApiUpsertModelAssignment = new ApiDefine<UpsertModelAssignmentRequest, UpsertModelAssignmentResponse>("/v1/user-preference/model-assignment", "POST");
export const ApiListModels = new ApiDefine<ListModelsRequest, ListModelsResponse>("/v1/user-preference/list-models", "POST");
