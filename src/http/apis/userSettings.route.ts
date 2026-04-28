import * as UserSettingsApi from "../../../shared/contracts/apis/userSettings.api.js";
import type { ErrorResponse } from "../../../shared/contracts/httpApi.js";
import { AI_FUNCTIONS } from "../../../shared/aiFunctions.js";
import { createModelClientFromConfig } from "../../agent/index.js";
import { registerApi } from "../registerApi.js";
import { toErrorResponse, type HttpApiContext } from "./apiContext.js";

async function listModelsForProvider(context: HttpApiContext, provider: string): Promise<string[]> {
    const modelEntry = context.config.models[provider];
    if (!modelEntry) return [];

    if (modelEntry.availableModels.length > 0) {
        return [...modelEntry.availableModels].sort();
    }

    const apiKey = context.userSettingsStore.getApiKey(provider);
    if (!apiKey) return [];

    const client = createModelClientFromConfig({
        provider: modelEntry.provider,
        model: modelEntry.defaultModel || "model-for-listing",
        apiUrl: modelEntry.apiUrl,
        apiKey
    });
    const models = await client.listModels();
    return models.sort();
}

async function getUserSettings(context: HttpApiContext): Promise<UserSettingsApi.GetUserSettingsResponse> {
    const settings = context.userSettingsStore.read();
    const providerKeys = Object.keys(context.config.models);

    const providers: UserSettingsApi.ProviderStatus[] = await Promise.all(providerKeys.map(async (p) => ({
        provider: p,
        apiKeySet: Boolean(context.userSettingsStore.getApiKey(p)),
        availableModels: await listModelsForProvider(context, p)
    })));

    const functionModels: UserSettingsApi.FunctionModelMap = {};
    for (const fn of AI_FUNCTIONS) {
        const assignment = settings.functionModels?.[fn];
        functionModels[fn] = assignment ?? null;
    }

    const response: UserSettingsApi.GetUserSettingsResponse = { providers, functionModels };
    return response;
}


async function upsertApiKey(context: HttpApiContext, body: UserSettingsApi.UpsertApiKeyRequest)
    : Promise<UserSettingsApi.UpsertApiKeyResponse> {

    const provider = (body?.provider ?? "").trim().toLowerCase();
    const apiKey = (body?.apiKey ?? "").trim();

    if (!provider) throw new Error("provider is required");
    if (!context.config.models[provider]) throw new Error(`Unsupported provider: ${provider}`);
    if (!apiKey) throw new Error("apiKey is required");

    context.userSettingsStore.setApiKey(provider, apiKey);

    const availableModels = await listModelsForProvider(context, provider);

    return {
        provider,
        apiKeySet: true,
        availableModels
    };
}

async function deleteApiKey(context: HttpApiContext, body: UserSettingsApi.DeleteApiKeyRequest)
    : Promise<UserSettingsApi.DeleteApiKeyResponse> {

    const provider = (body?.provider ?? "").trim().toLowerCase();
    if (!provider) throw new Error("provider is required");

    context.userSettingsStore.setApiKey(provider, null);

    return { provider, apiKeySet: false };
}

async function testApiKey(context: HttpApiContext, body: UserSettingsApi.TestApiKeyRequest)
    : Promise<UserSettingsApi.TestApiKeyResponse> {

    const provider = (body?.provider ?? "").trim().toLowerCase();
    if (!provider) throw new Error("provider is required");

    const modelEntry = context.config.models[provider];
    if (!modelEntry) throw new Error(`Unsupported provider: ${provider}`);

    const apiKey = context.userSettingsStore.getApiKey(provider);
    if (!apiKey) {
        return { provider, ok: false, message: "API key not set" };
    }

    try {
        const client = createModelClientFromConfig({
            provider: modelEntry.provider,
            model: modelEntry.defaultModel || "model-for-listing",
            apiUrl: modelEntry.apiUrl,
            apiKey
        });
        const models = await client.listModels();
        return { provider, ok: true, message: `${models.length} model(s) available` };
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { provider, ok: false, message };
    }
}

async function upsertFunctionModel(context: HttpApiContext, body: UserSettingsApi.UpsertFunctionModelRequest)
    : Promise<UserSettingsApi.UpsertFunctionModelResponse> {

    const fn = body?.function;
    const provider = (body?.provider ?? "").trim().toLowerCase();
    const model = (body?.model ?? "").trim();

    if (!fn || !(AI_FUNCTIONS as readonly string[]).includes(fn)) {
        throw new Error(`Invalid function: ${fn}`);
    }
    if (!provider) throw new Error("provider is required");
    if (!model) throw new Error("model is required");

    const updated = context.userSettingsStore.setFunctionModel(fn, provider, model);
    const functionModels: UserSettingsApi.FunctionModelMap = {};
    for (const f of AI_FUNCTIONS) {
        functionModels[f] = updated.functionModels?.[f] ?? null;
    }
    return { functionModels };
}

async function listModels(context: HttpApiContext, body: UserSettingsApi.ListModelsRequest)
    : Promise<UserSettingsApi.ListModelsResponse> {

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
    // GET /v1/user-settings
    registerApi(context.app, UserSettingsApi.ApiGetUserSettings, {
        handleRequest: () => getUserSettings(context),
        handleError: (error) => handleError("getUserSettings: failed", context, error)
    });

    // POST /v1/user-settings/api-key
    registerApi(context.app, UserSettingsApi.ApiUpsertApiKey, {
        handleRequest: (_, body) => upsertApiKey(context, body),
        handleError: (error) => handleError("upsertApiKey: failed", context, error)
    });

    // POST /v1/user-settings/api-key/delete
    registerApi(context.app, UserSettingsApi.ApiDeleteApiKey, {
        handleRequest: (_, body) => deleteApiKey(context, body),
        handleError: (error) => handleError("deleteApiKey: failed", context, error)
    });

    // POST /v1/user-settings/test-api-key
    registerApi(context.app, UserSettingsApi.ApiTestApiKey, {
        handleRequest: (_, body) => testApiKey(context, body),
        handleError: (error) => handleError("testApiKey: failed", context, error)
    });

    // POST /v1/user-settings/function-model
    registerApi(context.app, UserSettingsApi.ApiUpsertFunctionModel, {
        handleRequest: (_, body) => upsertFunctionModel(context, body),
        handleError: (error) => handleError("upsertFunctionModel: failed", context, error)
    });

    // POST /v1/user-settings/list-models
    registerApi(context.app, UserSettingsApi.ApiListModels, {
        handleRequest: (_, body) => listModels(context, body),
        handleError: (error) => handleError("listModels: failed", context, error)
    });
}
