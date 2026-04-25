import type {
    GetUserSettingsResponse,
    UpsertUserSettingsRequest,
    UpsertUserSettingsResponse
} from "../../../shared/contracts/httpApi";
import { getUserSettings, upsertUserSettings } from "./apis/userSettings.client";

export interface UserSettingsViewState {
    providers: string[];
    currentProvider: string | null;
    currentModel: string | null;
    availableModels: string[];
    apiKeySet: boolean;
}

function toViewState(data: GetUserSettingsResponse | UpsertUserSettingsResponse): UserSettingsViewState {
    return {
        providers: data.providers,
        currentProvider: data.currentProvider,
        currentModel: data.currentModel,
        availableModels: data.availableModels,
        apiKeySet: data.apiKeySet
    };
}

export async function loadUserSettings(): Promise<UserSettingsViewState> {
    console.info("[facade] loadUserSettings started");
    const data = await getUserSettings();
    console.info("[facade] loadUserSettings completed", {
        currentProvider: data.currentProvider,
        currentModel: data.currentModel,
        apiKeySet: data.apiKeySet,
        modelCount: data.availableModels.length
    });

    return toViewState(data);
}

export async function upsertCurrentUserSettings(request: UpsertUserSettingsRequest): Promise<UserSettingsViewState> {
    console.info("[facade] upsertCurrentUserSettings started", {
        provider: request.provider,
        model: request.model,
        hasApiKey: Boolean(request.apiKey)
    });

    const data = await upsertUserSettings(request);
    console.info("[facade] upsertCurrentUserSettings completed", {
        currentProvider: data.currentProvider,
        currentModel: data.currentModel,
        apiKeySet: data.apiKeySet,
        modelCount: data.availableModels.length
    });

    return toViewState(data);
}
