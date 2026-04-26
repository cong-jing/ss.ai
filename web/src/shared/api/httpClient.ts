import type {
    ApiDefine,
    ApiRequestOf,
    ApiResponseOf,
    ErrorResponse
} from "../../../../shared/contracts/httpApi";

async function parseJson<T>(response: Response): Promise<T> {
    const data = await response.json() as T | ErrorResponse;
    if (!response.ok) {
        throw new Error((data as ErrorResponse)?.message ?? `Request failed: ${response.status}`);
    }

    return data as T;
}

export async function callApi<TApi extends ApiDefine<unknown, unknown>>(
    api: TApi,
    request?: ApiRequestOf<TApi>
): Promise<ApiResponseOf<TApi>> {
    const isGet = api.method === "GET";
    const response = await fetch(api.apiUrl, {
        method: api.method,
        headers: isGet ? undefined : { "Content-Type": "application/json" },
        body: isGet ? undefined : JSON.stringify(request ?? {})
    });

    return parseJson<ApiResponseOf<TApi>>(response);
}
