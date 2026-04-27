import {
    ApiGetUserSettings,
    ApiUpsertApiKey,
    ApiDeleteApiKey,
    ApiTestApiKey,
    ApiUpsertFunctionModel,
    ApiListModels,
    type GetUserSettingsResponse,
    type UpsertApiKeyResponse,
    type DeleteApiKeyResponse,
    type TestApiKeyResponse,
    type UpsertFunctionModelResponse,
    type ListModelsResponse
} from "../../../../shared/contracts/httpApi";
import { callApi } from "../../shared/api/httpClient";
import type { AiFunction } from "../../../../shared/aiFunctions";

export async function apiGetUserSettings(): Promise<GetUserSettingsResponse> {
    return callApi(ApiGetUserSettings);
}

export async function apiUpsertApiKey(provider: string, apiKey: string): Promise<UpsertApiKeyResponse> {
    return callApi(ApiUpsertApiKey, { provider, apiKey });
}

export async function apiDeleteApiKey(provider: string): Promise<DeleteApiKeyResponse> {
    return callApi(ApiDeleteApiKey, { provider });
}

export async function apiTestApiKey(provider: string): Promise<TestApiKeyResponse> {
    return callApi(ApiTestApiKey, { provider });
}

export async function apiUpsertFunctionModel(fn: AiFunction, provider: string, model: string): Promise<UpsertFunctionModelResponse> {
    return callApi(ApiUpsertFunctionModel, { function: fn, provider, model });
}

export async function apiListModels(provider: string): Promise<ListModelsResponse> {
    return callApi(ApiListModels, { provider });
}
