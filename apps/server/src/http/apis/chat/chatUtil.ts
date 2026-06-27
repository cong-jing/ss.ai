import { DEFAULT_INTERACTION_MODE, INTERACTION_MODES, type InteractionMode } from "@ss-ai/contracts";
import {
    MemoryCandidateRecorder,
    MemoryCommitService,
    ModelClientEmbeddingProvider,
    PersonaFlowChatTurnService,
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

const interactionModes = new Set<string>(INTERACTION_MODES);

export function resolveInteractionMode(value: unknown, endpoint: string): InteractionMode {
    if (value === undefined || value === null || value === "") {
        return DEFAULT_INTERACTION_MODE;
    }
    if (typeof value === "string" && interactionModes.has(value)) {
        return value as InteractionMode;
    }
    throw new HttpStatusError(
        400,
        `${endpoint}: interactionMode must be one of ${INTERACTION_MODES.join(", ")}.`,
    );
}

export async function createChatTurnService(context: HttpApiContext): Promise<PersonaFlowChatTurnService> {

    const promptLogger = new PromptLogger(context.config.promptLog);
    const defaultProviderApiKeys = Object.fromEntries(
        Object.entries(context.config.models).map(([provider, entry]) => [provider.toLowerCase(), entry.apiKey])
    );
    const modelClient = new DefaultModelClient({
        providerConfigs: context.config.models,
        timeoutMs: context.config.agent.timeoutMs,
        maxRetries: context.config.agent.maxRetries,
        logger: context.logger,
    });

    // Memory write pipeline dependencies. The recorder and commit service
    // both reuse the same logical clock + id generator so candidate ids,
    // memory ids, and decision rows stay consistent across the pipeline.
    // Keeping them inline (rather than promoting to module-level
    // singletons) makes it trivial for tests to swap deterministic
    // versions in via separate ChatTurnService construction.
    const memoryClock = { nowIso: () => new Date().toISOString() };
    const memoryIds = { randomId: () => crypto.randomUUID() };
    const embeddingProvider = new ModelClientEmbeddingProvider({
        modelClient,
        appStores: context.stores,
        defaultModelAssignments: context.config.defaultModelAssignments,
        defaultProviderApiKeys,
        logger: context.logger,
    });
    const memoryRecorder = new MemoryCandidateRecorder({
        candidateStore: context.stores.memoryCandidate,
        clock: memoryClock,
        ids: memoryIds,
        logger: context.logger,
    });
    const memoryCommitService = new MemoryCommitService({
        candidateStore: context.stores.memoryCandidate,
        memoryStore: context.stores.memory,
        decisionStore: context.stores.memoryDecision,
        embeddingProvider,
        clock: memoryClock,
        ids: memoryIds,
        logger: context.logger,
    });

    return new PersonaFlowChatTurnService({
        stores: context.stores,
        logger: context.logger,
        promptLogger: promptLogger,
        defaultModelAssignments: context.config.defaultModelAssignments,
        defaultProviderApiKeys,
        modelClient,
        memory: {
            recorder: memoryRecorder,
            commitService: memoryCommitService,
            config: context.config.memory,
        },
    });
}
