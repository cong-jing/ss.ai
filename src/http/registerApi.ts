import type { Express, Request, RequestHandler } from "express";
import type { ApiDefine, ErrorResponse } from "../../shared/contracts/httpApi.js";
import type { HttpApiContext } from "./apis/apiContext.js";

export interface RegisterApiOptions<TRequest, TResponse> {
    handleRequest: (request: Request, body: TRequest) =>
        Promise<TResponse> | TResponse;
    handleError?: (error: unknown, request: Request, body: TRequest) => {
        status: number;
        body: ErrorResponse;
    };
}

export function registerApi<TRequest, TResponse>(
    app: Express,
    api: ApiDefine<TRequest, TResponse>,
    handler: RegisterApiOptions<TRequest, TResponse>
): void {
    const wrappedHandler: RequestHandler = async (request, response) => {
        try {
            const body = (api.method === "GET" ? undefined : request.body) as TRequest;
            const result = await handler.handleRequest(request, body);
            response.json(result);
        } catch (error) {
            const fallback = {
                status: 400,
                body: {
                    message: error instanceof Error ? error.message : "Unknown error"
                } satisfies ErrorResponse
            };

            const errorResult = handler.handleError ? handler.handleError(
                error, request, (api.method === "GET" ? undefined : request.body) as TRequest) : fallback;
            response.status(errorResult.status).json(errorResult.body);
        }
    };

    if (api.method === "GET") {
        app.get(api.apiUrl, wrappedHandler);
        return;
    }

    app.post(api.apiUrl, wrappedHandler);
}
