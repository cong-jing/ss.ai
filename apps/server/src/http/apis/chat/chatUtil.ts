import { DEFAULT_PROMPT_MODE, PROMPT_MODES, type LlmResponseMode, type PromptMode } from "@ss-ai/contracts";
import {
    PersonaFlowChatTurnService
} from "@ss-ai/persona-flow";
import { DefaultModelClient } from "@ss-ai/persona-flow-model-client";
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

const promptModes = new Set<string>(PROMPT_MODES);

export function resolvePromptMode(value: unknown, endpoint: string): PromptMode {
    if (value === undefined || value === null || value === "") {
        return DEFAULT_PROMPT_MODE;
    }
    if (typeof value === "string" && promptModes.has(value)) {
        return value as PromptMode;
    }
    throw new HttpStatusError(
        400,
        `${endpoint}: promptMode must be one of ${PROMPT_MODES.join(", ")}.`,
    );
}

export async function createChatTurnService(context: HttpApiContext): Promise<PersonaFlowChatTurnService> {
    //const modelService = await createChatModelService(userId, context);
    const promptLogger = new PromptLogger(context.config.promptLog);
    return new PersonaFlowChatTurnService({
        stores: context.stores,
        logger: context.logger,
        promptLogger: promptLogger,
        modelClient: new DefaultModelClient({
            providerConfigs: context.config.models,
            timeoutMs: context.config.agent.timeoutMs,
            maxRetries: context.config.agent.maxRetries,
        }),
    });
}
