import { ApiDefine } from "../apiBase.js";
import type { ModelAssignment, ModelCallPurpose } from "../modelCallPurpose.js";

// --- Provider info ---

export interface ProviderStatus {
    provider: string;
    apiKeySet: boolean;
    availableModels: string[];
}

// --- Model assignment ---

export type UserModelAssignmentMap = Partial<Record<ModelCallPurpose, ModelAssignment | null>>;

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
    availableModels: string[];
}

// --- POST /v1/user-preference/api-key/delete ---

export interface DeleteApiKeyRequest {
    provider: string;
}

export interface DeleteApiKeyResponse {
    provider: string;
    apiKeySet: boolean;
}

// --- POST /v1/user-preference/test-api-key ---

export interface TestApiKeyRequest {
    provider: string;
}

export interface TestApiKeyResponse {
    provider: string;
    ok: boolean;
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
