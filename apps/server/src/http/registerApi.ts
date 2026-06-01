import type { Express, Request, RequestHandler } from "express";
import type { ApiDefine, ErrorResponse } from "@ss-ai/contracts";
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
            const body = (api.method === "GET" ? request.query : request.body) as TRequest;
            const result = await handler.handleRequest(request, body);
            if (result === undefined || result === null) {
                response.status(204).send();
            } else {
                response.json(result);
            }
        } catch (error) {
            // Store on locals so the HTTP logging middleware can emit the stack trace
            response.locals.routeError = error;

            const fallback = {
                status: 400,
                body: {
                    message: error instanceof Error ? error.message : "Unknown error"
                } satisfies ErrorResponse
            };

            const errorResult = handler.handleError ? handler.handleError(
                error, request, (api.method === "GET" ? request.query : request.body) as TRequest) : fallback;
            response.status(errorResult.status).json(errorResult.body);
        }
    };

    switch (api.method) {
        case "GET": app.get(api.apiUrl, wrappedHandler); break;
        case "POST": app.post(api.apiUrl, wrappedHandler); break;
        case "PATCH": app.patch(api.apiUrl, wrappedHandler); break;
        case "DELETE": app.delete(api.apiUrl, wrappedHandler); break;
    }
}
