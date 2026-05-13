import type { LlmResponseMode } from "@ss-ai/contracts";
import {
    PersonaFlowChatTurnService,
    PersonaFlowModelService,
} from "@ss-ai/persona-flow";
import { createModelClientFromConfig } from "../../../agent/clients/clientFactory.js";
import { PromptLogger } from "../../../util/promptLog.js";
import type { HttpApiContext } from "../apiContext.js";

export class HttpStatusError extends Error {
    constructor(public readonly status: number, message: string) {
        super(message);
    }
}

export function getStatusCode(error: unknown, fallback = 400): number {
    if (error instanceof HttpStatusError) {
        return error.status;
    }
    if (
        error
        && typeof error === "object"
        && "status" in error
        && typeof (error as { status?: unknown }).status === "number"
    ) {
        return (error as { status: number }).status;
    }
    return fallback;
}

export function requireNonEmptyString(value: unknown, fieldName: string, endpoint: string): string {
    if (typeof value !== "string" || value.trim().length === 0) {
        throw new HttpStatusError(400, `${endpoint}: ${fieldName} is required.`);
    }
    return value;
}

export function requireUserMessageText(userMessageText: unknown, endpoint: string): string {
    if (typeof userMessageText !== "string" || userMessageText.trim().length === 0) {
        throw new HttpStatusError(400, `${endpoint}: userMessageText is required.`);
    }
    return userMessageText;
}

export function resolveLlmResponseMode(value: unknown, endpoint: string, defaultMode: LlmResponseMode): LlmResponseMode {
    if (value === undefined || value === null || value === "") {
        return defaultMode;
    }
    if (value === "structured" || value === "non-structured") {
        return value;
    }
    throw new HttpStatusError(400, `${endpoint}: llmResponseMode must be 'structured' or 'non-structured'.`);
}

export async function createChatModelService(context: HttpApiContext, userId: string): Promise<PersonaFlowModelService> {
    const promptLogger = new PromptLogger(context.config.promptLog);
    const service = new PersonaFlowModelService({
        userId,
        userPreferencesStore: context.stores.userPreferences,
        providerCredentialStore: context.stores.providerCredential,
        resolveProviderConfig: (provider) => {
            const modelEntry = context.config.models[provider];
            if (!modelEntry) {
                return null;
            }
            return {
                provider: modelEntry.provider,
                apiUrl: modelEntry.apiUrl,
            };
        },
        createModelClient: (input) => createModelClientFromConfig(input),
        timeoutMs: context.config.agent.timeoutMs,
        maxRetries: context.config.agent.maxRetries,
        onPromptLog: (entry) => promptLogger.write(entry),
        onVerboseLog: (message, payload) => context.logger.verbose(
            message,
            payload && typeof payload === "object"
                ? payload as Record<string, unknown>
                : { payload },
        ),
    });

    try {
        await service.ensureFunctionReady("chat");
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Unknown error";
        throw new HttpStatusError(400, message);
    }

    return service;
}

export function createChatTurnService(context: HttpApiContext): PersonaFlowChatTurnService {
    return new PersonaFlowChatTurnService({
        stores: context.stores,
        getModelServiceForUser: (userId: string) => createChatModelService(context, userId),
    });
}
