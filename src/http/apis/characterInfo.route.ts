import {
    ApiGetCharacterInfo,
    ApiUpsertCharacterInfo
} from "../../../shared/contracts/httpApi";
import { registerApi } from "../registerApi";
import { toErrorResponse, type HttpApiContext } from "./apiContext";
import type { JsonFileStore } from "../jsonFileStore";

interface CharacterInfoData {
    name: string;
    description: string;
}

export function registerCharacterInfoRoutes(context: HttpApiContext, store: JsonFileStore<CharacterInfoData>): void {
    registerApi(context.app, ApiGetCharacterInfo, () => {
        return store.read();
    });

    registerApi(context.app, ApiUpsertCharacterInfo, ({ body }) => {
        const name = typeof body?.name === "string" ? body.name : "";
        const description = typeof body?.description === "string" ? body.description : "";
        return store.update({ name, description });
    }, {
        onError: (error) => {
            const response = toErrorResponse(error);
            return { status: 400, body: response };
        }
    });
}
