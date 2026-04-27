import {
    ApiGetUserSettings,
    ApiUpsertUserSettings,
    type GetUserSettingsResponse,
    type UpsertUserSettingsResponse
} from "../../../../shared/contracts/httpApi";
import { callApi } from "../../shared/api/httpClient";
import type { SaveUserSettingsPayload, UserSettings } from "./userSettingsTypes";

function mapResponseToSettings(
    response: GetUserSettingsResponse | UpsertUserSettingsResponse,
    previousApiKey = ""
): UserSettings {
    return {
        providers: response.providers,
        currentProvider: response.currentProvider,
        currentModel: response.currentModel,
        availableModels: response.availableModels,
        apiKey: previousApiKey,
        apiKeySet: response.apiKeySet
    };
}

export async function apiGetUserSettings(): Promise<UserSettings> {
    const response = await callApi(ApiGetUserSettings);
    return mapResponseToSettings(response);
}

export async function apiSaveUserSettings(payload: SaveUserSettingsPayload, previousApiKey = ""): Promise<UserSettings> {
    const response = await callApi(ApiUpsertUserSettings, {
        provider: payload.provider,
        model: payload.model,
        apiKey: payload.apiKey
    });

    return mapResponseToSettings(response, previousApiKey);
}
