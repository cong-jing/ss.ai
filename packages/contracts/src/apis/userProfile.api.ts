import { ApiDefine } from "../apiBase.js";

export interface GetUserProfileResponse {
    name: string;
    bio: string;
    preferredAddress?: string | null;
}

export interface UpsertUserProfileRequest {
    name: string;
    bio: string;
    preferredAddress?: string | null;
}

export interface UpsertUserProfileResponse {
    name: string;
    bio: string;
    preferredAddress?: string | null;
}

export const ApiGetUserProfile = new ApiDefine<void, GetUserProfileResponse>("/v1/user-profile", "GET");
export const ApiUpsertUserProfile = new ApiDefine<UpsertUserProfileRequest, UpsertUserProfileResponse>("/v1/user-profile", "POST");
