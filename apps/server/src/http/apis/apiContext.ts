import type { Express } from "express";
import type { RuntimeConfig } from "../../util/config.js";
import type { Logger } from "@ss-ai/persona-flow-logger";
import type { ErrorResponse } from "@ss-ai/contracts";
import type { AppStores } from "@ss-ai/persona-flow";

/** The userId used for all single-user operations. */
export const DEFAULT_USER_ID = "default";

export interface HttpApiContext {
    app: Express;
    logger: Logger;
    config: RuntimeConfig;
    stores: AppStores;
}

export function toErrorResponse(error: unknown): ErrorResponse {
    return {
        message: error instanceof Error ? error.message : "Unknown error"
    };
}
