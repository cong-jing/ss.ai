import { ApiDefine } from "../apiBase";

export interface UpsertCharacterInfoRequest {
    name: string;
    description: string;
}

export interface UpsertCharacterInfoResponse {
    name: string;
    description: string;
}

export const ApiUpsertCharacterInfo = new ApiDefine<UpsertCharacterInfoRequest, UpsertCharacterInfoResponse>("/v1/character-info", "POST");
