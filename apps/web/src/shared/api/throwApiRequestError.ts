import type { ErrorResponse } from "@ss-ai/contracts";
import { ApiRequestError } from "./apiRequestError";

export async function throwApiRequestError(response: Response): Promise<never> {
    const text = await response.text();
    const payload = (text ? JSON.parse(text) : undefined) as ErrorResponse | undefined;
    throw new ApiRequestError({
        status: response.status,
        message: payload?.message ?? `Request failed: ${response.status}`,
        code: payload?.code,
        params: payload?.params,
    });
}