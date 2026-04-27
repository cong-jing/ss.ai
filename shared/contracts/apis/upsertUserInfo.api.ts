import { ApiDefine } from "../apiBase";

export interface UpsertUserInfoRequest {
    name: string;
    bio: string;
}

export interface UpsertUserInfoResponse {
    name: string;
    bio: string;
}

export const ApiUpsertUserInfo = new ApiDefine<UpsertUserInfoRequest, UpsertUserInfoResponse>("/v1/user-info", "POST");
