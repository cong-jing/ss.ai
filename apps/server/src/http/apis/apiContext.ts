import type { Express } from "express";
import type { Request } from "express";
import type { RuntimeConfig } from "../../util/config.js";
import type { Logger } from "@ss-ai/persona-flow-logger";
import type { ErrorResponse } from "@ss-ai/contracts";
import type { AppStores } from "@ss-ai/persona-flow";
import type { AuthRuntime, RequestUser } from "../../auth/authRuntime.js";

export interface HttpApiContext {
    app: Express;
    logger: Logger;
    config: RuntimeConfig;
    stores: AppStores;
    authRuntime: AuthRuntime;
}

export function toErrorResponse(error: unknown): ErrorResponse {
    return {
        message: error instanceof Error ? error.message : "Unknown error"
    };
}

export async function resolveRequestUser(req: Request, context: HttpApiContext): Promise<RequestUser> {
    // Auth replacement guide:
    // Keep business routes calling this helper. When switching auth providers,
    // only the auth runtime implementation needs to change (credential -> userId).
    return await context.authRuntime.requireUser(req);
}

export async function resolveRequestUserId(req: Request, context: HttpApiContext): Promise<string> {
    return (await resolveRequestUser(req, context)).userId;
}
