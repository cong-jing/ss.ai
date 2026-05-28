export class AuthHttpError extends Error {
    readonly statusCode: number;

    constructor(statusCode: number, message: string) {
        super(message);
        this.name = "AuthHttpError";
        this.statusCode = statusCode;
    }
}

export function getErrorStatusCode(error: unknown, fallback = 400): number {
    if (error instanceof AuthHttpError) {
        return error.statusCode;
    }
    return fallback;
}
