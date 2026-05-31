import type {
    ApiDefine,
    ApiRequestOf,
    ApiResponseOf,
    ErrorResponse
} from "@ss-ai/contracts";
import { ApiRequestError } from "./apiRequestError";

async function parseJson<T>(response: Response): Promise<T> {
    if (response.status === 204) {
        return undefined as T;
    }

    const text = await response.text();
    const data = (text ? JSON.parse(text) : undefined) as T | ErrorResponse | undefined;
    if (!response.ok) {
        const payload = data as ErrorResponse | undefined;
        throw new ApiRequestError({
            status: response.status,
            message: payload?.message ?? `Request failed: ${response.status}`,
            code: payload?.code,
            params: payload?.params,
        });
    }

    return (data ?? undefined) as T;
}

export async function callApi<TApi extends ApiDefine<unknown, unknown>>(
    api: TApi,
    request?: ApiRequestOf<TApi>
): Promise<ApiResponseOf<TApi>> {
    const isGet = api.method === "GET";
    const response = await fetch(api.apiUrl, {
        method: api.method,
        credentials: "same-origin",
        headers: isGet ? undefined : { "Content-Type": "application/json" },
        body: isGet ? undefined : JSON.stringify(request ?? {})
    });

    return parseJson<ApiResponseOf<TApi>>(response);
}
