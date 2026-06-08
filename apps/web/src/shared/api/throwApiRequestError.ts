import { ApiRequestError } from "./apiRequestError";
import { parseErrorResponse } from "./parseErrorResponse";

export async function throwApiRequestError(response: Response): Promise<never> {
    const text = await response.text();
    const payload = parseErrorResponse(text);
    throw new ApiRequestError({
        status: response.status,
        message: payload?.message ?? `Request failed: ${response.status}`,
        code: payload?.code,
        params: payload?.params,
    });
}