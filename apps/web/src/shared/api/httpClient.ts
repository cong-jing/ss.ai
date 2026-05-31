import type {
    ApiDefine,
    ApiRequestOf,
    ApiResponseOf,
    ErrorResponse
} from "@ss-ai/contracts";
import { ApiRequestError } from "./apiRequestError";
import { parseErrorResponse } from "./parseErrorResponse";

function buildApiUrl<TApi extends ApiDefine<unknown, unknown>>(api: TApi, request?: ApiRequestOf<TApi>): string {
    if (api.method !== "GET" || request === undefined || request === null) {
        return api.apiUrl;
    }
    const searchParams = new URLSearchParams();
    for (const [key, value] of Object.entries(request as Record<string, unknown>)) {
        if (value === undefined || value === null) continue;
        searchParams.set(key, String(value));
    }
    const query = searchParams.toString();
    return query ? `${api.apiUrl}?${query}` : api.apiUrl;
}

async function parseJson<T>(response: Response): Promise<T> {
    if (response.status === 204) {
        return undefined as T;
    }

    const text = await response.text();
    if (!response.ok) {
        const payload = parseErrorResponse(text);
        throw new ApiRequestError({
            status: response.status,
            message: payload?.message ?? `Request failed: ${response.status}`,
            code: payload?.code,
            params: payload?.params,
        });
    }

    const data = (text ? JSON.parse(text) : undefined) as T | ErrorResponse | undefined;

    return (data ?? undefined) as T;
}

export async function callApi<TApi extends ApiDefine<unknown, unknown>>(
    api: TApi,
    request?: ApiRequestOf<TApi>
): Promise<ApiResponseOf<TApi>> {
    const isGet = api.method === "GET";
    const response = await fetch(buildApiUrl(api, request), {
        method: api.method,
        credentials: "same-origin",
        headers: isGet ? undefined : { "Content-Type": "application/json" },
        body: isGet ? undefined : JSON.stringify(request ?? {})
    });

    return parseJson<ApiResponseOf<TApi>>(response);
}
