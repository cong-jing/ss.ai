import { ApiDefine } from "../apiBase.js";

export interface GetCharacterInfoResponse {
    name: string;
    description: string;
}

export interface UpsertCharacterInfoRequest {
    name: string;
    description: string;
}

export interface UpsertCharacterInfoResponse {
    name: string;
    description: string;
}

export const ApiGetCharacterInfo = new ApiDefine<void, GetCharacterInfoResponse>("/v1/character-info", "GET");
export const ApiUpsertCharacterInfo = new ApiDefine<UpsertCharacterInfoRequest, UpsertCharacterInfoResponse>("/v1/character-info", "POST");
