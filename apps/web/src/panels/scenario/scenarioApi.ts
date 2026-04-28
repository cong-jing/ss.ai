import {
    ApiGetUserInfo,
    ApiUpsertUserInfo,
    ApiGetCharacterInfo,
    ApiUpsertCharacterInfo
} from "@ss-ai/contracts";
import { callApi } from "../../shared/api/httpClient";
import type { UserInfo, CharacterInfo } from "./scenarioTypes";

export async function apiGetUserInfo(): Promise<UserInfo> {
    return callApi(ApiGetUserInfo);
}

export async function apiSaveUserInfo(info: UserInfo): Promise<UserInfo> {
    return callApi(ApiUpsertUserInfo, { name: info.name, bio: info.bio });
}

export async function apiGetCharacterInfo(): Promise<CharacterInfo> {
    return callApi(ApiGetCharacterInfo);
}

export async function apiSaveCharacterInfo(info: CharacterInfo): Promise<CharacterInfo> {
    return callApi(ApiUpsertCharacterInfo, { name: info.name, description: info.description });
}
