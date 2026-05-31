import type { AppErrorCode, ErrorParams } from "@ss-ai/contracts";

export class AppHttpError extends Error {
    readonly statusCode: number;
    readonly code: AppErrorCode;
    readonly params?: ErrorParams;

    constructor(statusCode: number, code: AppErrorCode, message: string, params?: ErrorParams) {
        super(message);
        this.name = "AppHttpError";
        this.statusCode = statusCode;
        this.code = code;
        this.params = params;
    }
}

export function getAppErrorStatusCode(error: unknown, fallback = 400): number {
    if (error instanceof AppHttpError) {
        return error.statusCode;
    }
    return fallback;
}