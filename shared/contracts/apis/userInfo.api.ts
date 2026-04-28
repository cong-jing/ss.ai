import { ApiDefine } from "../apiBase.js";

export interface GetUserInfoResponse {
    name: string;
    bio: string;
}

export interface UpsertUserInfoRequest {
    name: string;
    bio: string;
}

export interface UpsertUserInfoResponse {
    name: string;
    bio: string;
}

export const ApiGetUserInfo = new ApiDefine<void, GetUserInfoResponse>("/v1/user-info", "GET");
export const ApiUpsertUserInfo = new ApiDefine<UpsertUserInfoRequest, UpsertUserInfoResponse>("/v1/user-info", "POST");
