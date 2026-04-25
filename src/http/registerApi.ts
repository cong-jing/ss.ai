import type { Express, Request, RequestHandler } from "express";
import type { ApiDefine, ErrorResponse } from "../../shared/contracts/httpApi";

export interface RegisterApiOptions {
    onError?: (error: unknown, request: Request) => {
        status: number;
        body: ErrorResponse;
    };
}

export function registerApi<TRequest, TResponse>(
    app: Express,
    api: ApiDefine<TRequest, TResponse>,
    handler: (input: { request: Request; body: TRequest }) => Promise<TResponse> | TResponse,
    options?: RegisterApiOptions
): void {
    const wrappedHandler: RequestHandler = async (request, response) => {
        try {
            const body = (api.method === "GET" ? undefined : request.body) as TRequest;
            const result = await handler({ request, body });
            response.json(result);
        } catch (error) {
            const fallback = {
                status: 400,
                body: {
                    message: error instanceof Error ? error.message : "Unknown error"
                } satisfies ErrorResponse
            };

            const errorResult = options?.onError ? options.onError(error, request) : fallback;
            response.status(errorResult.status).json(errorResult.body);
        }
    };

    if (api.method === "GET") {
        app.get(api.apiUrl, wrappedHandler);
        return;
    }

    app.post(api.apiUrl, wrappedHandler);
}
