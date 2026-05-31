import type { ErrorResponse } from "@ss-ai/contracts";

export function parseErrorResponse(text: string): ErrorResponse | undefined {
    if (!text) {
        return undefined;
    }

    try {
        return JSON.parse(text) as ErrorResponse;
    } catch {
        return undefined;
    }
}