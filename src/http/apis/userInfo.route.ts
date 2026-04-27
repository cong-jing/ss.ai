import {
    ApiGetUserInfo,
    ApiUpsertUserInfo
} from "../../../shared/contracts/httpApi";
import { registerApi } from "../registerApi";
import { toErrorResponse, type HttpApiContext } from "./apiContext";
import type { JsonFileStore } from "../jsonFileStore";

interface UserInfoData {
    name: string;
    bio: string;
}

export function registerUserInfoRoutes(context: HttpApiContext, store: JsonFileStore<UserInfoData>): void {
    registerApi(context.app, ApiGetUserInfo, () => {
        return store.read();
    });

    registerApi(context.app, ApiUpsertUserInfo, ({ body }) => {
        const name = typeof body?.name === "string" ? body.name : "";
        const bio = typeof body?.bio === "string" ? body.bio : "";
        return store.update({ name, bio });
    }, {
        onError: (error) => {
            const response = toErrorResponse(error);
            return { status: 400, body: response };
        }
    });
}
