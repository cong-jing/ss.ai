import { ApiDefine } from "../apiBase";

export interface GetUserSettingsResponse {
    providers: string[];
    currentProvider: string | null;
    apiKeySet: boolean;
    currentModel: string | null;
    availableModels: string[];
}

export const ApiGetUserSettings = new ApiDefine<void, GetUserSettingsResponse>("/v1/user-settings", "GET");
