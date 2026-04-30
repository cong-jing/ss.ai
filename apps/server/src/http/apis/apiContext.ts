import type { Express } from "express";
import type { RuntimeConfig } from "../../util/config.js";
import { Logger } from "../../util/logger.js";
import type { ErrorResponse } from "@ss-ai/contracts";
import type {
    MessageStore,
    UserProfileStore,
    UserPreferencesStore,
    UserProviderCredentialStore,
} from "@ss-ai/persona-flow";

/** The userId used for all single-user operations. */
export const DEFAULT_USER_ID = "default";

export interface HttpApiContext {
    app: Express;
    logger: Logger;
    config: RuntimeConfig;
    userProfileStore: UserProfileStore;
    userPreferencesStore: UserPreferencesStore;
    userProviderCredentialStore: UserProviderCredentialStore;
    messageStore: MessageStore;
}

export function toErrorResponse(error: unknown): ErrorResponse {
    return {
        message: error instanceof Error ? error.message : "Unknown error"
    };
}
