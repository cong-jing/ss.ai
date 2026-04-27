import { ApiDefine } from "../apiBase";

export interface GetCharacterInfoResponse {
    name: string;
    description: string;
}

export const ApiGetCharacterInfo = new ApiDefine<void, GetCharacterInfoResponse>("/v1/character-info", "GET");
