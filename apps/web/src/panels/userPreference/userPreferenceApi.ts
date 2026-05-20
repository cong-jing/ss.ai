import {
    ApiGetUserPreference,
    ApiUpsertApiKey,
    ApiDeleteApiKey,
    ApiTestApiKey,
    ApiUpsertModelAssignment,
    ApiListModels,
    type GetUserPreferenceResponse,
    type UpsertApiKeyResponse,
    type DeleteApiKeyResponse,
    type TestApiKeyResponse,
    type UpsertModelAssignmentResponse,
    type ListModelsResponse
} from "@ss-ai/contracts";
import { callApi } from "../../shared/api/httpClient";
import type { ModelCallPurpose } from "@ss-ai/contracts";

export async function apiGetUserPreference(): Promise<GetUserPreferenceResponse> {
    return callApi(ApiGetUserPreference);
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

export async function apiUpsertModelAssignment(modelCallPurpose: ModelCallPurpose, provider: string, model: string): Promise<UpsertModelAssignmentResponse> {
    return callApi(ApiUpsertModelAssignment, { modelCallPurpose, provider, model });
}

export async function apiListModels(provider: string): Promise<ListModelsResponse> {
    return callApi(ApiListModels, { provider });
}
