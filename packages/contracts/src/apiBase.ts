import type { AppErrorCode, ErrorParams } from "./errorCode.js";

export type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE";

export class ApiDefine<TRequest, TResponse> {
    public readonly method: HttpMethod;
    public readonly apiUrl: string;

    constructor(apiUrl: string, method: HttpMethod) {
        this.apiUrl = apiUrl;
        this.method = method;
    }
}

export type ApiRequestOf<TApi extends ApiDefine<unknown, unknown>> =
    TApi extends ApiDefine<infer TRequest, unknown> ? TRequest : never;

export type ApiResponseOf<TApi extends ApiDefine<unknown, unknown>> =
    TApi extends ApiDefine<unknown, infer TResponse> ? TResponse : never;

export interface ErrorResponse {
    message: string;
    code?: AppErrorCode;
    params?: ErrorParams;
}
