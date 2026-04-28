import {
    ApiGetUserInfo,
    ApiUpsertUserInfo
} from "../../../shared/contracts/httpApi.js";
import { registerApi } from "../registerApi.js";
import { toErrorResponse, type HttpApiContext } from "./apiContext.js";
import type { JsonFileStore } from "../jsonFileStore.js";

interface UserInfoData {
    name: string;
    bio: string;
}

export function registerUserInfoRoutes(context: HttpApiContext, store: JsonFileStore<UserInfoData>): void {
    registerApi(context.app, ApiGetUserInfo, {
        handleRequest: () => store.read()
    });

    registerApi(context.app, ApiUpsertUserInfo, {
        handleRequest: (_, body) => {
            const name = typeof body?.name === "string" ? body.name : "";
            const bio = typeof body?.bio === "string" ? body.bio : "";
            return store.update({ name, bio });
        },
        handleError: (error) => {
            const response = toErrorResponse(error);
            return { status: 400, body: response };
        }
    });
}
