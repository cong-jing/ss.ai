import {
    ApiAuthLogin,
    ApiAuthLogout,
    ApiAuthMe,
    ApiAuthRegister,
    type AuthMeResponse,
    type AuthSessionResponse,
} from "@ss-ai/contracts";
import { callApi } from "../shared/api/httpClient";

export async function apiAuthMe(): Promise<AuthMeResponse> {
    return await callApi(ApiAuthMe);
}

export async function apiAuthLogin(username: string, password: string): Promise<AuthSessionResponse> {
    return await callApi(ApiAuthLogin, { username, password });
}

export async function apiAuthRegister(username: string, password: string, displayName?: string): Promise<AuthSessionResponse> {
    return await callApi(ApiAuthRegister, { username, password, displayName: displayName ?? null });
}

export async function apiAuthLogout(): Promise<void> {
    await callApi(ApiAuthLogout);
}
