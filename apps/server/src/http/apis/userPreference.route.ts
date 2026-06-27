import * as UserPreferenceApi from "@ss-ai/contracts/apis/userPreference";
import type { ErrorResponse } from "@ss-ai/contracts";
import { MODEL_CALL_PURPOSES } from "@ss-ai/contracts";
import { DefaultModelClient } from "@ss-ai/persona-flow-model-client";
import { registerApi } from "../registerApi.js";
import { toErrorResponse, resolveRequestUserId, type HttpApiContext } from "./apiContext.js";
import { AppHttpError, getAppErrorStatusCode } from "../errors/appHttpError.js";

function getDefaultProviderApiKey(context: HttpApiContext, provider: string): string {
    return context.config.models[provider]?.apiKey?.trim() ?? "";
}

function getEffectiveProviderApiKeySource(
    context: HttpApiContext,
    provider: string,
    hasUserCredential: boolean,
): UserPreferenceApi.ApiKeySource {
    if (hasUserCredential) return "user";
    return getDefaultProviderApiKey(context, provider) ? "default" : "missing";
}

function getEffectiveApiKey(context: HttpApiContext, provider: string, encryptedApiKey?: string): {
    encryptedApiKey: string | null;
    source: UserPreferenceApi.ApiKeySource;
} {
    if (encryptedApiKey?.trim()) {
        return { encryptedApiKey, source: "user" };
    }

    const defaultApiKey = getDefaultProviderApiKey(context, provider);
    if (defaultApiKey) {
        return { encryptedApiKey: defaultApiKey, source: "default" };
    }

    return { encryptedApiKey: null, source: "missing" };
}

async function listModelsForProvider(
    context: HttpApiContext,
    provider: string,
    userId: string,
): Promise<UserPreferenceApi.ProviderAvailableModels> {
    const modelEntry = context.config.models[provider];
    if (!modelEntry) return { chat: [], embed: [] };

    // When either category has been pre-listed in config we trust the static
    // lists exclusively. Most providers (Mistral included) return chat and
    // embed models in a single flat /v1/models response with no reliable
    // category marker, so live probing cannot safely populate the embed
    // bucket on its own.
    const staticChat = modelEntry.availableModels.chat;
    const staticEmbed = modelEntry.availableModels.embed;
    if (staticChat.length > 0 || staticEmbed.length > 0) {
        return {
            chat: [...staticChat].sort(),
            embed: [...staticEmbed].sort(),
        };
    }

    const credential = await context.stores.providerCredential.getCredential({ userId, provider });
    const resolvedApiKey = getEffectiveApiKey(context, provider, credential?.encryptedApiKey);
    if (!resolvedApiKey.encryptedApiKey) return { chat: [], embed: [] };

    const client = new DefaultModelClient({
        providerConfigs: context.config.models,
        timeoutMs: context.config.agent.timeoutMs,
        maxRetries: context.config.agent.maxRetries,
        logger: context.logger,
    });
    // Live fallback: dump everything into `chat` because we have no per-model
    // category info from the provider. Embedding assignments must come from
    // a static config that explicitly enumerates `availableModels.embed`.
    const models = await client.listModels(provider, resolvedApiKey.encryptedApiKey);
    return { chat: models.sort(), embed: [] };
}

async function getUserPreference(context: HttpApiContext, userId: string): Promise<UserPreferenceApi.GetUserPreferenceResponse> {
    const prefs = await context.stores.userPreferences.getUserPreferences(userId);
    const credentials = await context.stores.providerCredential.listCredentials(userId);
    const credsByProvider = new Map(credentials.map(c => [c.provider, c]));

    const providerKeys = Object.keys(context.config.models);
    const providers: UserPreferenceApi.ProviderStatus[] = await Promise.all(
        providerKeys.map(async (p) => ({
            provider: p,
            userApiKeySet: credsByProvider.has(p),
            defaultApiKeySet: !!getDefaultProviderApiKey(context, p),
            effectiveApiKeySource: getEffectiveProviderApiKeySource(context, p, credsByProvider.has(p)),
            defaultApiKeyWarning: getDefaultProviderApiKey(context, p)
                ? "Shared default API key may be rate-limited, quota-limited, or less stable. Add your own API key for better reliability."
                : undefined,
            availableModels: await listModelsForProvider(context, p, userId),
        }))
    );

    const modelAssignments: UserPreferenceApi.UserModelAssignmentMap = {};
    for (const purpose of MODEL_CALL_PURPOSES) {
        const userAssignment = prefs?.modelAssignments?.[purpose] ?? null;
        const defaultAssignment = context.config.defaultModelAssignments?.[purpose] ?? null;
        const effectiveAssignment = userAssignment ?? defaultAssignment ?? null;
        modelAssignments[purpose] = {
            userAssignment,
            defaultAssignment,
            effectiveAssignment,
            effectiveSource: userAssignment ? "user" : (defaultAssignment ? "default" : "missing"),
        };
    }

    return { providers, modelAssignments };
}

async function upsertApiKey(
    context: HttpApiContext,
    userId: string,
    body: UserPreferenceApi.UpsertApiKeyRequest
): Promise<UserPreferenceApi.UpsertApiKeyResponse> {
    const provider = (body?.provider ?? "").trim().toLowerCase();
    const apiKey = (body?.apiKey ?? "").trim();

    if (!provider) throw new AppHttpError(400, "user_preference.provider_required", "provider is required");
    if (!context.config.models[provider]) throw new AppHttpError(400, "user_preference.provider_unsupported", `Unsupported provider: ${provider}`);
    if (!apiKey) throw new AppHttpError(400, "user_preference.api_key_required", "apiKey is required");

    const now = new Date().toISOString();
    const existing = await context.stores.providerCredential.getCredential({ userId, provider });
    await context.stores.providerCredential.upsertCredential({
        userId,
        provider,
        encryptedApiKey: apiKey,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
    });

    const availableModels = await listModelsForProvider(context, provider, userId);
    return { provider, apiKeySet: true, availableModels };
}

async function deleteApiKey(
    context: HttpApiContext,
    userId: string,
    body: UserPreferenceApi.DeleteApiKeyRequest
): Promise<UserPreferenceApi.DeleteApiKeyResponse> {
    const provider = (body?.provider ?? "").trim().toLowerCase();
    if (!provider) throw new AppHttpError(400, "user_preference.provider_required", "provider is required");

    await context.stores.providerCredential.deleteCredential({ userId, provider });
    return { provider, apiKeySet: false };
}

async function testApiKey(
    context: HttpApiContext,
    userId: string,
    body: UserPreferenceApi.TestApiKeyRequest
): Promise<UserPreferenceApi.TestApiKeyResponse> {
    const provider = (body?.provider ?? "").trim().toLowerCase();
    if (!provider) throw new AppHttpError(400, "user_preference.provider_required", "provider is required");

    if (!context.config.models[provider]) throw new AppHttpError(400, "user_preference.provider_unsupported", `Unsupported provider: ${provider}`);

    const credential = await context.stores.providerCredential.getCredential({ userId, provider });
    const resolvedApiKey = getEffectiveApiKey(context, provider, credential?.encryptedApiKey);
    if (!resolvedApiKey.encryptedApiKey) {
        return { provider, ok: false, source: "missing", message: "API key not set" };
    }
    try {
        const client = new DefaultModelClient({
            providerConfigs: context.config.models,
            timeoutMs: context.config.agent.timeoutMs,
            maxRetries: context.config.agent.maxRetries,
            logger: context.logger,
        });
        const models = await client.listModels(provider, resolvedApiKey.encryptedApiKey);
        return {
            provider,
            ok: true,
            source: resolvedApiKey.source,
            message: `${models.length} model(s) available`,
        };
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { provider, ok: false, source: resolvedApiKey.source, message };
    }
}

async function upsertModelAssignment(
    context: HttpApiContext,
    userId: string,
    body: UserPreferenceApi.UpsertModelAssignmentRequest
): Promise<UserPreferenceApi.UpsertModelAssignmentResponse> {
    const modelCallPurpose = body?.modelCallPurpose;
    const provider = (body?.provider ?? "").trim().toLowerCase();
    const model = (body?.model ?? "").trim();

    if (!modelCallPurpose || !(MODEL_CALL_PURPOSES as readonly string[]).includes(modelCallPurpose)) {
        throw new AppHttpError(400, "user_preference.model_call_purpose_invalid", `Invalid model call purpose: ${modelCallPurpose}`);
    }
    if (!provider) throw new AppHttpError(400, "user_preference.provider_required", "provider is required");
    if (!model) throw new AppHttpError(400, "user_preference.model_required", "model is required");

    const now = new Date().toISOString();
    await context.stores.userPreferences.setModelAssignment({
        userId,
        modelCallPurpose,
        assignment: { provider, model },
        updatedAt: now,
    });

    const prefs = await context.stores.userPreferences.getUserPreferences(userId);
    const modelAssignments: UserPreferenceApi.UserModelAssignmentMap = {};
    for (const purpose of MODEL_CALL_PURPOSES) {
        const userAssignment = prefs?.modelAssignments?.[purpose] ?? null;
        const defaultAssignment = context.config.defaultModelAssignments?.[purpose] ?? null;
        const effectiveAssignment = userAssignment ?? defaultAssignment ?? null;
        modelAssignments[purpose] = {
            userAssignment,
            defaultAssignment,
            effectiveAssignment,
            effectiveSource: userAssignment ? "user" : (defaultAssignment ? "default" : "missing"),
        };
    }
    return { modelAssignments };
}

async function listModels(
    context: HttpApiContext,
    userId: string,
    body: UserPreferenceApi.ListModelsRequest
): Promise<UserPreferenceApi.ListModelsResponse> {
    const provider = (body?.provider ?? "").trim().toLowerCase();
    if (!provider) throw new AppHttpError(400, "user_preference.provider_required", "provider is required");
    if (!context.config.models[provider]) throw new AppHttpError(400, "user_preference.provider_unsupported", `Unsupported provider: ${provider}`);

    // The list-models endpoint is a connectivity / enumeration probe and its
    // contract is intentionally category-less. Static config splits chat /
    // embed; we flatten here so legacy callers (and the load-models button)
    // see one unified list. Sorting keeps the response deterministic.
    const categorized = await listModelsForProvider(context, provider, userId);
    const merged = Array.from(new Set([...categorized.chat, ...categorized.embed])).sort();
    return { provider, models: merged };
}

function handleError(message: string, context: HttpApiContext, error: unknown): {
    status: number;
    body: ErrorResponse;
} {
    const response = toErrorResponse(error);
    context.logger.error(message, { message: response.message });
    return { status: getAppErrorStatusCode(error, 400), body: response };
}

export function registerUserPreferenceRoutes(context: HttpApiContext): void {
    registerApi(context.app, UserPreferenceApi.ApiGetUserPreference, {
        handleRequest: async (req) => getUserPreference(context, await resolveRequestUserId(req, context)),
        handleError: (error) => handleError("getUserPreference: failed", context, error)
    });

    registerApi(context.app, UserPreferenceApi.ApiUpsertApiKey, {
        handleRequest: async (req, body) => upsertApiKey(context, await resolveRequestUserId(req, context), body),
        handleError: (error) => handleError("upsertApiKey: failed", context, error)
    });

    registerApi(context.app, UserPreferenceApi.ApiDeleteApiKey, {
        handleRequest: async (req, body) => deleteApiKey(context, await resolveRequestUserId(req, context), body),
        handleError: (error) => handleError("deleteApiKey: failed", context, error)
    });

    registerApi(context.app, UserPreferenceApi.ApiTestApiKey, {
        handleRequest: async (req, body) => testApiKey(context, await resolveRequestUserId(req, context), body),
        handleError: (error) => handleError("testApiKey: failed", context, error)
    });

    registerApi(context.app, UserPreferenceApi.ApiUpsertModelAssignment, {
        handleRequest: async (req, body) => upsertModelAssignment(context, await resolveRequestUserId(req, context), body),
        handleError: (error) => handleError("upsertModelAssignment: failed", context, error)
    });

    registerApi(context.app, UserPreferenceApi.ApiListModels, {
        handleRequest: async (req, body) => listModels(context, await resolveRequestUserId(req, context), body),
        handleError: (error) => handleError("listModels: failed", context, error)
    });
}
