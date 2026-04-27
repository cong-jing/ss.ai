import { ApiDefine } from "../apiBase";

export interface GetUserInfoResponse {
    name: string;
    bio: string;
}

export const ApiGetUserInfo = new ApiDefine<void, GetUserInfoResponse>("/v1/user-info", "GET");
