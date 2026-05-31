import type { AuthErrorCode, ErrorParams, ErrorResponse } from "@ss-ai/contracts";

export class AuthHttpError extends Error {
    readonly statusCode: number;
    readonly code: AuthErrorCode;
    readonly params?: ErrorParams;

    constructor(statusCode: number, code: AuthErrorCode, message: string, params?: ErrorParams) {
        super(message);
        this.name = "AuthHttpError";
        this.statusCode = statusCode;
        this.code = code;
        this.params = params;
    }
}

export function getErrorStatusCode(error: unknown, fallback = 400): number {
    if (error instanceof AuthHttpError) {
        return error.statusCode;
    }
    return fallback;
}

export function toAuthErrorResponse(error: unknown): ErrorResponse {
    if (error instanceof AuthHttpError) {
        return {
            message: error.message,
            code: error.code,
            params: error.params,
        };
    }

    return {
        message: error instanceof Error ? error.message : "Unknown error",
    };
}
