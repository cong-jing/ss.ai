import type { AppErrorCode, ErrorParams } from "@ss-ai/contracts";

export class ApiRequestError extends Error {
    readonly status: number;
    readonly code?: AppErrorCode;
    readonly params?: ErrorParams;

    constructor(input: { status: number; message: string; code?: AppErrorCode; params?: ErrorParams }) {
        super(input.message);
        this.name = "ApiRequestError";
        this.status = input.status;
        this.code = input.code;
        this.params = input.params;
    }
}