import {
    ApiGetUserSettings,
    ApiUpsertApiKey,
    ApiDeleteApiKey,
    ApiTestApiKey,
    ApiUpsertFunctionModel,
    ApiListModels,
    type GetUserSettingsResponse,
    type ProviderStatus,
    type FunctionModelMap
} from "../../../shared/contracts/httpApi";
import { AI_FUNCTIONS } from "../../../shared/aiFunctions";
import { createModelClientFromConfig } from "../../agent";
import { registerApi } from "../registerApi";
import {
    toErrorResponse,
    type HttpApiContext
} from "./apiContext";

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

export function registerUserSettingsRoutes(context: HttpApiContext): void {
    // GET /v1/user-settings
    registerApi(context.app, ApiGetUserSettings, async () => {
        const settings = context.userSettingsStore.read();
        const providerKeys = Object.keys(context.config.models);

        const providers: ProviderStatus[] = providerKeys.map((p) => ({
            provider: p,
            apiKeySet: Boolean(context.userSettingsStore.getApiKey(p)),
            availableModels: []
        }));

        const functionModels: FunctionModelMap = {};
        for (const fn of AI_FUNCTIONS) {
            const assignment = settings.functionModels?.[fn];
            functionModels[fn] = assignment ?? null;
        }

        const response: GetUserSettingsResponse = { providers, functionModels };
        return response;
    }, {
        onError: (error) => {
            const response = toErrorResponse(error);
            context.logger.error("getUserSettings: failed", { message: response.message });
            return { status: 400, body: response };
        }
    });

    // POST /v1/user-settings/api-key
    registerApi(context.app, ApiUpsertApiKey, async ({ body }) => {
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
    }, {
        onError: (error) => {
            const response = toErrorResponse(error);
            context.logger.error("upsertApiKey: failed", { message: response.message });
            return { status: 400, body: response };
        }
    });

    // POST /v1/user-settings/api-key/delete
    registerApi(context.app, ApiDeleteApiKey, async ({ body }) => {
        const provider = (body?.provider ?? "").trim().toLowerCase();
        if (!provider) throw new Error("provider is required");

        context.userSettingsStore.setApiKey(provider, null);

        return {
            provider,
            apiKeySet: false
        };
    }, {
        onError: (error) => {
            const response = toErrorResponse(error);
            context.logger.error("deleteApiKey: failed", { message: response.message });
            return { status: 400, body: response };
        }
    });

    // POST /v1/user-settings/test-api-key
    registerApi(context.app, ApiTestApiKey, async ({ body }) => {
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
    }, {
        onError: (error) => {
            const response = toErrorResponse(error);
            context.logger.error("testApiKey: failed", { message: response.message });
            return { status: 400, body: response };
        }
    });

    // POST /v1/user-settings/function-model
    registerApi(context.app, ApiUpsertFunctionModel, async ({ body }) => {
        const fn = body?.function;
        const provider = (body?.provider ?? "").trim().toLowerCase();
        const model = (body?.model ?? "").trim();

        if (!fn || !(AI_FUNCTIONS as readonly string[]).includes(fn)) {
            throw new Error(`Invalid function: ${fn}`);
        }
        if (!provider) throw new Error("provider is required");
        if (!model) throw new Error("model is required");

        const updated = context.userSettingsStore.setFunctionModel(fn, provider, model);
        const functionModels: FunctionModelMap = {};
        for (const f of AI_FUNCTIONS) {
            functionModels[f] = updated.functionModels?.[f] ?? null;
        }
        return { functionModels };
    }, {
        onError: (error) => {
            const response = toErrorResponse(error);
            context.logger.error("upsertFunctionModel: failed", { message: response.message });
            return { status: 400, body: response };
        }
    });

    // POST /v1/user-settings/list-models
    registerApi(context.app, ApiListModels, async ({ body }) => {
        const provider = (body?.provider ?? "").trim().toLowerCase();
        if (!provider) throw new Error("provider is required");
        if (!context.config.models[provider]) throw new Error(`Unsupported provider: ${provider}`);

        const models = await listModelsForProvider(context, provider);
        return { provider, models };
    }, {
        onError: (error) => {
            const response = toErrorResponse(error);
            context.logger.error("listModels: failed", { message: response.message });
            return { status: 400, body: response };
        }
    });
}
