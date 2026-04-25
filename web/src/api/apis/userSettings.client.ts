import {
    ApiGetUserSettings,
    ApiUpsertUserSettings,
    type GetUserSettingsResponse,
    type UpsertUserSettingsRequest,
    type UpsertUserSettingsResponse
} from "../../../../shared/contracts/httpApi";
import { callApi } from "../httpClient";

export async function getUserSettings(): Promise<GetUserSettingsResponse> {
    return callApi(ApiGetUserSettings);
}

export async function upsertUserSettings(request: UpsertUserSettingsRequest): Promise<UpsertUserSettingsResponse> {
    return callApi(ApiUpsertUserSettings, request);
}
