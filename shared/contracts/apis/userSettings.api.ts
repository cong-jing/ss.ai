import { ApiDefine } from "../apiBase.js";
import type { AiFunction } from "../../aiFunctions.js";

// --- Provider info ---

export interface ProviderStatus {
    provider: string;
    apiKeySet: boolean;
    availableModels: string[];
}

// --- Function model assignment ---

export type FunctionModelMap = Partial<Record<AiFunction, { provider: string; model: string } | null>>;

// --- GET /v1/user-settings ---

export interface GetUserSettingsResponse {
    providers: ProviderStatus[];
    functionModels: FunctionModelMap;
}

// --- POST /v1/user-settings/api-key ---

export interface UpsertApiKeyRequest {
    provider: string;
    apiKey: string;
}

export interface UpsertApiKeyResponse {
    provider: string;
    apiKeySet: boolean;
    availableModels: string[];
}

// --- DELETE /v1/user-settings/api-key ---

export interface DeleteApiKeyRequest {
    provider: string;
}

export interface DeleteApiKeyResponse {
    provider: string;
    apiKeySet: boolean;
}

// --- POST /v1/user-settings/test-api-key ---

export interface TestApiKeyRequest {
    provider: string;
}

export interface TestApiKeyResponse {
    provider: string;
    ok: boolean;
    message?: string;
}

// --- POST /v1/user-settings/function-model ---

export interface UpsertFunctionModelRequest {
    function: AiFunction;
    provider: string;
    model: string;
}

export interface UpsertFunctionModelResponse {
    functionModels: FunctionModelMap;
}

// --- POST /v1/user-settings/list-models ---

export interface ListModelsRequest {
    provider: string;
}

export interface ListModelsResponse {
    provider: string;
    models: string[];
}

export const ApiGetUserSettings = new ApiDefine<void, GetUserSettingsResponse>("/v1/user-settings", "GET");
export const ApiUpsertApiKey = new ApiDefine<UpsertApiKeyRequest, UpsertApiKeyResponse>("/v1/user-settings/api-key", "POST");
export const ApiDeleteApiKey = new ApiDefine<DeleteApiKeyRequest, DeleteApiKeyResponse>("/v1/user-settings/api-key/delete", "POST");
export const ApiTestApiKey = new ApiDefine<TestApiKeyRequest, TestApiKeyResponse>("/v1/user-settings/test-api-key", "POST");
export const ApiUpsertFunctionModel = new ApiDefine<UpsertFunctionModelRequest, UpsertFunctionModelResponse>("/v1/user-settings/function-model", "POST");
export const ApiListModels = new ApiDefine<ListModelsRequest, ListModelsResponse>("/v1/user-settings/list-models", "POST");
