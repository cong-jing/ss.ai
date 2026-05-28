import { ApiDefine } from "../apiBase.js";

export type AuthMode = "default-user" | "local-password";

export interface AuthUserInfo {
    id: string;
    username: string;
    displayName: string | null;
}

export interface AuthMeResponse {
    authMode: AuthMode;
    allowRegistration: boolean;
    authenticated: boolean;
    user: AuthUserInfo | null;
}

export interface RegisterRequest {
    username: string;
    password: string;
    displayName?: string | null;
}

export interface LoginRequest {
    username: string;
    password: string;
}

export interface AuthSessionResponse {
    authMode: AuthMode;
    authenticated: true;
    user: AuthUserInfo;
}

export const ApiAuthMe = new ApiDefine<void, AuthMeResponse>("/v1/auth/me", "GET");
export const ApiAuthRegister = new ApiDefine<RegisterRequest, AuthSessionResponse>("/v1/auth/register", "POST");
export const ApiAuthLogin = new ApiDefine<LoginRequest, AuthSessionResponse>("/v1/auth/login", "POST");
export const ApiAuthLogout = new ApiDefine<void, void>("/v1/auth/logout", "POST");
