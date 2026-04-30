import { ApiDefine } from "../apiBase.js";

export interface GetUserInfoResponse {
    name: string;
    bio: string;
    preferredAddress?: string | null;
}

export interface UpsertUserInfoRequest {
    name: string;
    bio: string;
    preferredAddress?: string | null;
}

export interface UpsertUserInfoResponse {
    name: string;
    bio: string;
    preferredAddress?: string | null;
}

export const ApiGetUserInfo = new ApiDefine<void, GetUserInfoResponse>("/v1/user-info", "GET");
export const ApiUpsertUserInfo = new ApiDefine<UpsertUserInfoRequest, UpsertUserInfoResponse>("/v1/user-info", "POST");
