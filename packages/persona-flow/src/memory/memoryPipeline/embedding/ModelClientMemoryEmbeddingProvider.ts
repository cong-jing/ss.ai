import type { ModelAssignmentMap, ModelCallPurpose } from "@ss-ai/contracts";
import type { ModelClient, ModelUsage } from "../../../llm/modelClient.js";
import type { AppStores } from "../../../stores/appStores.js";
import { createNoopPersonaFlowLogger, type PersonaFlowLogger } from "../../../chatTurn/personaFlowLogger.js";
import type {
    MemoryEmbedInput,
    MemoryEmbedResult,
    MemoryEmbeddingProvider,
} from "./embeddingPorts.js";

/**
 * Error codes the adapter surfaces. Callers (processor, debug API)
 * match on `code` to decide between retry, alert, or fail-soft.
 */
export type ModelClientMemoryEmbeddingProviderErrorCode =
    | "assignment_missing"
    | "api_key_missing"
    | "embed_unsupported"
    | "embed_failed"
    | "empty_response"
    | "invalid_response";

export class ModelClientMemoryEmbeddingProviderError extends Error {
    public readonly code: ModelClientMemoryEmbeddingProviderErrorCode;

    constructor(code: ModelClientMemoryEmbeddingProviderErrorCode, message: string, options?: ErrorOptions) {
        super(message, options);
        this.name = "ModelClientMemoryEmbeddingProviderError";
        this.code = code;
    }
}

/** Always-fixed purpose this adapter resolves against. */
export const MEMORY_EMBED_PURPOSE: ModelCallPurpose = "memory.embed";

export interface ModelClientMemoryEmbeddingProviderDeps {
    modelClient: ModelClient;
    appStores: AppStores;
    defaultModelAssignments?: ModelAssignmentMap;
    /**
     * Provider name (lowercased) → encrypted API key. Used as a
     * fallback when the user has not supplied their own credential
     * for the resolved provider. Mirrors the structure consumed by
     * `ModelRuntime`.
     */
    defaultProviderApiKeys?: Record<string, string>;
    /**
     * Embedding "signature" version covering NON-model factors:
     * text preprocessing, prompt wrapping, normalization strategy.
     * Bump when any of those change in a way that should invalidate
     * stored vectors. Defaults to 1.
     */
    embeddingVersion?: number;
    logger?: PersonaFlowLogger;
}

/**
 * Adapter that satisfies {@link MemoryEmbeddingProvider} by
 * delegating to a `ModelClient.embed()` implementation. Lives under
 * `memoryPipeline/embedding/` because it is the embedding-stage
 * port adapter; the memory core stays free of provider / runtime
 * dependencies because every other stage talks only to
 * {@link MemoryEmbeddingProvider}.
 *
 * Resolution order for the embedding model:
 *  1. If `input.userId` is supplied AND that user has set
 *     `modelAssignments["memory.embed"]`, use the user's assignment.
 *  2. Otherwise fall back to
 *     `defaultModelAssignments["memory.embed"]`.
 *  3. Otherwise throw `assignment_missing`.
 *
 * API key resolution mirrors `ModelRuntime`: per-user credential
 * first, then `defaultProviderApiKeys[provider]`. Missing key →
 * `api_key_missing`.
 */
export class ModelClientMemoryEmbeddingProvider implements MemoryEmbeddingProvider {
    private readonly logger: PersonaFlowLogger;
    private readonly embeddingVersion: number;

    constructor(private readonly deps: ModelClientMemoryEmbeddingProviderDeps) {
        this.logger = deps.logger ?? createNoopPersonaFlowLogger();
        this.embeddingVersion = deps.embeddingVersion ?? 1;
    }

    async embed(input: MemoryEmbedInput): Promise<MemoryEmbedResult> {
        const text = typeof input.text === "string" ? input.text : "";
        if (text.length === 0) {
            // Caller (processor) is expected to skip low-value drafts
            // before embedding. Treat empty as a programming error
            // rather than silently embedding "".
            throw new ModelClientMemoryEmbeddingProviderError(
                "embed_failed",
                "Memory embed: input.text is empty after coercion",
            );
        }

        const { provider, model } = await this.resolveAssignment(input.userId);
        const encryptedApiKey = await this.resolveApiKey(provider, input.userId);

        if (!this.deps.modelClient.embed) {
            throw new ModelClientMemoryEmbeddingProviderError(
                "embed_unsupported",
                `Memory embed: model client does not implement embed() (provider="${provider}").`,
            );
        }

        const purposeLabel = input.purpose || "memory.embed";
        this.logger.debug("memory.embed: calling model client", {
            provider,
            model,
            purpose: purposeLabel,
            userId: input.userId,
        });

        let result;
        try {
            result = await this.deps.modelClient.embed({
                provider,
                model,
                encryptedApiKey,
                inputs: [text],
            });
        } catch (error) {
            throw new ModelClientMemoryEmbeddingProviderError(
                "embed_failed",
                `Memory embed: model client embed() threw (provider="${provider}", model="${model}").`,
                { cause: error },
            );
        }

        const vector = result?.vectors?.[0];
        if (!Array.isArray(vector) || vector.length === 0) {
            throw new ModelClientMemoryEmbeddingProviderError(
                "empty_response",
                `Memory embed: model client returned no vector (provider="${provider}", model="${model}").`,
            );
        }
        // Defensive: the real Mistral path already rejects non-finite numbers,
        // but this adapter is the boundary for any future ModelClient. If we
        // let a vector with NaN / Infinity through, downstream similarity
        // checks would silently return NaN and the candidate would look like
        // a "no similar memories" hit instead of an embedding failure.
        if (!isFiniteNumberArray(vector)) {
            throw new ModelClientMemoryEmbeddingProviderError(
                "invalid_response",
                `Memory embed: model client returned a vector with non-finite values (provider="${provider}", model="${model}").`,
            );
        }

        const usage = toMemoryEmbedUsage(result.usage);
        return {
            embedding: {
                vector,
                provider,
                model: result.model || model,
                dim: vector.length,
                version: this.embeddingVersion,
                createdAt: new Date().toISOString(),
            },
            ...(usage ? { usage } : {}),
        };
    }

    private async resolveAssignment(userId: string | undefined): Promise<{ provider: string; model: string }> {
        let userAssignment: { provider: string; model: string } | undefined;
        if (userId) {
            const prefs = await this.deps.appStores.userPreferences.getUserPreferences(userId);
            const candidate = prefs?.modelAssignments?.[MEMORY_EMBED_PURPOSE];
            if (candidate?.provider && candidate?.model) {
                userAssignment = { provider: candidate.provider, model: candidate.model };
            }
        }
        const defaultAssignment = this.deps.defaultModelAssignments?.[MEMORY_EMBED_PURPOSE];
        const assignment = userAssignment ?? (
            defaultAssignment?.provider && defaultAssignment?.model
                ? { provider: defaultAssignment.provider, model: defaultAssignment.model }
                : undefined
        );
        if (!assignment) {
            throw new ModelClientMemoryEmbeddingProviderError(
                "assignment_missing",
                `Memory embed: no model assignment for "${MEMORY_EMBED_PURPOSE}" (userId=${userId ?? "<none>"}). `
                + "Set defaultModelAssignments.memory.embed in server config or a per-user override.",
            );
        }
        return assignment;
    }

    private async resolveApiKey(provider: string, userId: string | undefined): Promise<string> {
        let userKey: string | undefined;
        if (userId) {
            const credential = await this.deps.appStores.providerCredential.getCredential({ userId, provider });
            const trimmed = credential?.encryptedApiKey?.trim();
            if (trimmed) {
                userKey = trimmed;
            }
        }
        const fallback = this.deps.defaultProviderApiKeys?.[provider.toLowerCase()]?.trim() ?? "";
        const encryptedApiKey = userKey ?? fallback;
        if (!encryptedApiKey) {
            throw new ModelClientMemoryEmbeddingProviderError(
                "api_key_missing",
                `Memory embed: no API key for provider="${provider}" (userId=${userId ?? "<none>"}).`,
            );
        }
        return encryptedApiKey;
    }
}

function toMemoryEmbedUsage(raw: ModelUsage | undefined): MemoryEmbedResult["usage"] | undefined {
    if (!raw) return undefined;
    const promptTokens = typeof raw.promptTokens === "number" ? raw.promptTokens : undefined;
    const totalTokens = typeof raw.totalTokens === "number" ? raw.totalTokens : undefined;
    if (promptTokens === undefined && totalTokens === undefined) return undefined;
    return {
        ...(promptTokens !== undefined ? { promptTokens } : {}),
        ...(totalTokens !== undefined ? { totalTokens } : {}),
    };
}

function isFiniteNumberArray(value: unknown): value is number[] {
    return Array.isArray(value) && value.every((v) => typeof v === "number" && Number.isFinite(v));
}
