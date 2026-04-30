import * as UserSettingsApi from "@ss-ai/contracts/apis/userSettings";
import type { ErrorResponse } from "@ss-ai/contracts";
import { AI_FUNCTIONS } from "@ss-ai/contracts";
import { createModelClientFromConfig } from "../../agent/index.js";
import { registerApi } from "../registerApi.js";
import { toErrorResponse, DEFAULT_USER_ID, type HttpApiContext } from "./apiContext.js";

async function listModelsForProvider(context: HttpApiContext, provider: string): Promise<string[]> {
    const modelEntry = context.config.models[provider];
    if (!modelEntry) return [];

    if (modelEntry.availableModels.length > 0) {
        return [...modelEntry.availableModels].sort();
    }

    const credential = await context.userProviderCredentialStore.getCredential({ userId: DEFAULT_USER_ID, provider });
    if (!credential) return [];

    const client = createModelClientFromConfig({
        provider: modelEntry.provider,
        model: modelEntry.defaultModel || "model-for-listing",
        apiUrl: modelEntry.apiUrl,
        apiKey: credential.apiKeyEncrypted,
    });
    const models = await client.listModels();
    return models.sort();
}

async function getUserSettings(context: HttpApiContext): Promise<UserSettingsApi.GetUserSettingsResponse> {
    const prefs = await context.userPreferencesStore.getUserPreferences(DEFAULT_USER_ID);
    const credentials = await context.userProviderCredentialStore.listCredentials(DEFAULT_USER_ID);
    const credsByProvider = new Map(credentials.map(c => [c.provider, c]));

    const providerKeys = Object.keys(context.config.models);
    const providers: UserSettingsApi.ProviderStatus[] = await Promise.all(
        providerKeys.map(async (p) => ({
            provider: p,
            apiKeySet: credsByProvider.has(p),
            availableModels: await listModelsForProvider(context, p),
        }))
    );

    const functionModels: UserSettingsApi.FunctionModelMap = {};
    for (const fn of AI_FUNCTIONS) {
        const assignment = prefs?.functionModels?.[fn];
        functionModels[fn] = assignment ?? null;
    }

    return { providers, functionModels };
}

async function upsertApiKey(
    context: HttpApiContext,
    body: UserSettingsApi.UpsertApiKeyRequest
): Promise<UserSettingsApi.UpsertApiKeyResponse> {
    const provider = (body?.provider ?? "").trim().toLowerCase();
    const apiKey = (body?.apiKey ?? "").trim();

    if (!provider) throw new Error("provider is required");
    if (!context.config.models[provider]) throw new Error(`Unsupported provider: ${provider}`);
    if (!apiKey) throw new Error("apiKey is required");

    const now = new Date().toISOString();
    const existing = await context.userProviderCredentialStore.getCredential({ userId: DEFAULT_USER_ID, provider });
    await context.userProviderCredentialStore.upsertCredential({
        userId: DEFAULT_USER_ID,
        provider,
        apiKeyEncrypted: apiKey,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
    });

    const availableModels = await listModelsForProvider(context, provider);
    return { provider, apiKeySet: true, availableModels };
}

async function deleteApiKey(
    context: HttpApiContext,
    body: UserSettingsApi.DeleteApiKeyRequest
): Promise<UserSettingsApi.DeleteApiKeyResponse> {
    const provider = (body?.provider ?? "").trim().toLowerCase();
    if (!provider) throw new Error("provider is required");

    await context.userProviderCredentialStore.deleteCredential({ userId: DEFAULT_USER_ID, provider });
    return { provider, apiKeySet: false };
}

async function testApiKey(
    context: HttpApiContext,
    body: UserSettingsApi.TestApiKeyRequest
): Promise<UserSettingsApi.TestApiKeyResponse> {
    const provider = (body?.provider ?? "").trim().toLowerCase();
    if (!provider) throw new Error("provider is required");

    const modelEntry = context.config.models[provider];
    if (!modelEntry) throw new Error(`Unsupported provider: ${provider}`);

    const credential = await context.userProviderCredentialStore.getCredential({ userId: DEFAULT_USER_ID, provider });
    if (!credential) {
        return { provider, ok: false, message: "API key not set" };
    }

    try {
        const client = createModelClientFromConfig({
            provider: modelEntry.provider,
            model: modelEntry.defaultModel || "model-for-listing",
            apiUrl: modelEntry.apiUrl,
            apiKey: credential.apiKeyEncrypted,
        });
        const models = await client.listModels();
        return { provider, ok: true, message: `${models.length} model(s) available` };
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { provider, ok: false, message };
    }
}

async function upsertFunctionModel(
    context: HttpApiContext,
    body: UserSettingsApi.UpsertFunctionModelRequest
): Promise<UserSettingsApi.UpsertFunctionModelResponse> {
    const fn = body?.function;
    const provider = (body?.provider ?? "").trim().toLowerCase();
    const model = (body?.model ?? "").trim();

    if (!fn || !(AI_FUNCTIONS as readonly string[]).includes(fn)) {
        throw new Error(`Invalid function: ${fn}`);
    }
    if (!provider) throw new Error("provider is required");
    if (!model) throw new Error("model is required");

    const now = new Date().toISOString();
    await context.userPreferencesStore.setFunctionModel({
        userId: DEFAULT_USER_ID,
        functionName: fn,
        selection: { provider, model },
        updatedAt: now,
    });

    const prefs = await context.userPreferencesStore.getUserPreferences(DEFAULT_USER_ID);
    const functionModels: UserSettingsApi.FunctionModelMap = {};
    for (const f of AI_FUNCTIONS) {
        functionModels[f] = prefs?.functionModels?.[f] ?? null;
    }
    return { functionModels };
}

async function listModels(
    context: HttpApiContext,
    body: UserSettingsApi.ListModelsRequest
): Promise<UserSettingsApi.ListModelsResponse> {
    const provider = (body?.provider ?? "").trim().toLowerCase();
    if (!provider) throw new Error("provider is required");
    if (!context.config.models[provider]) throw new Error(`Unsupported provider: ${provider}`);

    const models = await listModelsForProvider(context, provider);
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

export function registerUserSettingsRoutes(context: HttpApiContext): void {
    registerApi(context.app, UserSettingsApi.ApiGetUserSettings, {
        handleRequest: () => getUserSettings(context),
        handleError: (error) => handleError("getUserSettings: failed", context, error)
    });

    registerApi(context.app, UserSettingsApi.ApiUpsertApiKey, {
        handleRequest: (_, body) => upsertApiKey(context, body),
        handleError: (error) => handleError("upsertApiKey: failed", context, error)
    });

    registerApi(context.app, UserSettingsApi.ApiDeleteApiKey, {
        handleRequest: (_, body) => deleteApiKey(context, body),
        handleError: (error) => handleError("deleteApiKey: failed", context, error)
    });

    registerApi(context.app, UserSettingsApi.ApiTestApiKey, {
        handleRequest: (_, body) => testApiKey(context, body),
        handleError: (error) => handleError("testApiKey: failed", context, error)
    });

    registerApi(context.app, UserSettingsApi.ApiUpsertFunctionModel, {
        handleRequest: (_, body) => upsertFunctionModel(context, body),
        handleError: (error) => handleError("upsertFunctionModel: failed", context, error)
    });

    registerApi(context.app, UserSettingsApi.ApiListModels, {
        handleRequest: (_, body) => listModels(context, body),
        handleError: (error) => handleError("listModels: failed", context, error)
    });
}
