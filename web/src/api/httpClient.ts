import type {
    ApiDefine,
    ApiRequestOf,
    ApiResponseOf,
    ErrorResponse
} from "../../../shared/contracts/httpApi";

function maskValueByKey(key: string, value: unknown): unknown {
    if (key.toLowerCase().includes("apikey") && typeof value === "string") {
        if (value.length <= 6) {
            return "***";
        }

        return `${value.slice(0, 3)}***${value.slice(-3)}`;
    }

    return value;
}

function sanitizePayload(payload: unknown): unknown {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        return payload;
    }

    const masked: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(payload)) {
        masked[key] = maskValueByKey(key, value);
    }

    return masked;
}

async function parseJson<T>(response: Response): Promise<T> {
    const data = await response.json() as T | ErrorResponse;
    if (!response.ok) {
        const message = (data as ErrorResponse)?.message ?? "请求失败";
        throw new Error(message);
    }

    return data as T;
}

export async function callApi<TApi extends ApiDefine<unknown, unknown>>(
    api: TApi,
    request?: ApiRequestOf<TApi>
): Promise<ApiResponseOf<TApi>> {
    const isGet = api.method === "GET";
    const startedAt = Date.now();
    const safeRequest = sanitizePayload(request);

    try {
        const response = await fetch(api.apiUrl, {
            method: api.method,
            headers: isGet ? undefined : { "Content-Type": "application/json" },
            body: isGet ? undefined : JSON.stringify(request ?? {})
        });

        return parseJson<ApiResponseOf<TApi>>(response);
    } catch (error) {
        console.error("[api] failed", {
            method: api.method,
            url: api.apiUrl,
            request: safeRequest,
            durationMs: Date.now() - startedAt,
            error: error instanceof Error ? error.message : String(error)
        });
        throw error;
    }
}
