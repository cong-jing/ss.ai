import {
    ApiGetCharacterInfo,
    ApiUpsertCharacterInfo
} from "../../../shared/contracts/httpApi.js";
import { registerApi } from "../registerApi.js";
import { toErrorResponse, type HttpApiContext } from "./apiContext.js";
import type { JsonFileStore } from "../jsonFileStore.js";

interface CharacterInfoData {
    name: string;
    description: string;
}

export function registerCharacterInfoRoutes(context: HttpApiContext, store: JsonFileStore<CharacterInfoData>): void {
    registerApi(context.app, ApiGetCharacterInfo, {
        handleRequest: () => store.read()
    });

    registerApi(context.app, ApiUpsertCharacterInfo, {
        handleRequest: (_, body) => {
            const name = typeof body?.name === "string" ? body.name : "";
            const description = typeof body?.description === "string" ? body.description : "";
            return store.update({ name, description });
        },
        handleError: (error) => {
            const response = toErrorResponse(error);
            return { status: 400, body: response };
        }
    });
}
