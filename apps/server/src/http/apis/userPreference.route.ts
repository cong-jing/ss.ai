import * as UserPreferenceApi from "@ss-ai/contracts/apis/userPreference";
import type { ErrorResponse } from "@ss-ai/contracts";
import { MODEL_CALL_PURPOSES } from "@ss-ai/contracts";
import { DefaultModelClient } from "@ss-ai/persona-flow-model-client";
import { registerApi } from "../registerApi.js";
import { toErrorResponse, resolveRequestUserId, type HttpApiContext } from "./apiContext.js";

async function listModelsForProvider(context: HttpApiContext, provider: string, userId: string): Promise<string[]> {
    const modelEntry = context.config.models[provider];
    if (!modelEntry) return [];

    if (modelEntry.availableModels.length > 0) {
        return [...modelEntry.availableModels].sort();
    }

    const credential = await context.stores.providerCredential.getCredential({ userId, provider });
    if (!credential) return [];

    const client = new DefaultModelClient({
        providerConfigs: context.config.models,
        timeoutMs: context.config.agent.timeoutMs,
        maxRetries: context.config.agent.maxRetries,
        logger: context.logger,
    });
    const models = await client.listModels(provider, credential.encryptedApiKey);
    return models.sort();
}

async function getUserPreference(context: HttpApiContext, userId: string): Promise<UserPreferenceApi.GetUserPreferenceResponse> {
    const prefs = await context.stores.userPreferences.getUserPreferences(userId);
    const credentials = await context.stores.providerCredential.listCredentials(userId);
    const credsByProvider = new Map(credentials.map(c => [c.provider, c]));

    const providerKeys = Object.keys(context.config.models);
    const providers: UserPreferenceApi.ProviderStatus[] = await Promise.all(
        providerKeys.map(async (p) => ({
            provider: p,
            apiKeySet: credsByProvider.has(p),
            availableModels: await listModelsForProvider(context, p, userId),
        }))
    );

    const modelAssignments: UserPreferenceApi.UserModelAssignmentMap = {};
    for (const purpose of MODEL_CALL_PURPOSES) {
        const assignment = prefs?.modelAssignments?.[purpose];
        modelAssignments[purpose] = assignment ?? null;
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

    if (!provider) throw new Error("provider is required");
    if (!context.config.models[provider]) throw new Error(`Unsupported provider: ${provider}`);
    if (!apiKey) throw new Error("apiKey is required");

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
    if (!provider) throw new Error("provider is required");

    await context.stores.providerCredential.deleteCredential({ userId, provider });
    return { provider, apiKeySet: false };
}

async function testApiKey(
    context: HttpApiContext,
    userId: string,
    body: UserPreferenceApi.TestApiKeyRequest
): Promise<UserPreferenceApi.TestApiKeyResponse> {
    const provider = (body?.provider ?? "").trim().toLowerCase();
    if (!provider) throw new Error("provider is required");

    const modelEntry = context.config.models[provider];
    if (!modelEntry) throw new Error(`Unsupported provider: ${provider}`);

    const credential = await context.stores.providerCredential.getCredential({ userId, provider });
    if (!credential) {
        return { provider, ok: false, message: "API key not set" };
    }

    try {
        const client = new DefaultModelClient({
            providerConfigs: context.config.models,
            timeoutMs: context.config.agent.timeoutMs,
            maxRetries: context.config.agent.maxRetries,
            logger: context.logger,
        });
        const models = await client.listModels(provider, credential.encryptedApiKey);
        return { provider, ok: true, message: `${models.length} model(s) available` };
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { provider, ok: false, message };
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
        throw new Error(`Invalid model call purpose: ${modelCallPurpose}`);
    }
    if (!provider) throw new Error("provider is required");
    if (!model) throw new Error("model is required");

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
        modelAssignments[purpose] = prefs?.modelAssignments?.[purpose] ?? null;
    }
    return { modelAssignments };
}

async function listModels(
    context: HttpApiContext,
    userId: string,
    body: UserPreferenceApi.ListModelsRequest
): Promise<UserPreferenceApi.ListModelsResponse> {
    const provider = (body?.provider ?? "").trim().toLowerCase();
    if (!provider) throw new Error("provider is required");
    if (!context.config.models[provider]) throw new Error(`Unsupported provider: ${provider}`);

    const models = await listModelsForProvider(context, provider, userId);
    return { provider, models };
}

function handleError(message: string, context: HttpApiContext, error: unknown): {
    status: number;
    body: ErrorResponse;
} {
    const response = toErrorResponse(error);
    context.logger.error(message, { message: response.message });
    return { status: 400, body: response };
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
