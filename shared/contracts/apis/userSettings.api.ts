import { ApiDefine } from "../apiBase";

export interface GetUserSettingsResponse {
    providers: string[];
    currentProvider: string | null;
    apiKeySet: boolean;
    currentModel: string | null;
    availableModels: string[];
}

export interface UpsertUserSettingsRequest {
    provider: string;
    apiKey: string | null;
    model: string | null;
}

export interface UpsertUserSettingsResponse {
    providers: string[];
    currentProvider: string | null;
    apiKeySet: boolean;
    currentModel: string | null;
    availableModels: string[];
}

export const ApiGetUserSettings = new ApiDefine<void, GetUserSettingsResponse>("/v1/user-settings", "GET");
export const ApiUpsertUserSettings = new ApiDefine<UpsertUserSettingsRequest, UpsertUserSettingsResponse>("/v1/user-settings", "POST");
