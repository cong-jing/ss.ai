import {
    ApiGetUserSettings,
    ApiUpsertUserSettings,
    type GetUserSettingsResponse
} from "../../../shared/contracts/httpApi";
import { createModelClientFromConfig } from "../../agent";
import { registerApi } from "../registerApi";
import {
    toErrorResponse,
    type HttpApiContext
} from "./apiContext";

async function buildUserSettingsResponse(context: HttpApiContext): Promise<GetUserSettingsResponse> {
    const settings = context.userSettingsStore.read();
    const providerKeys = Object.keys(context.config.models);
    let currentProvider = settings.currentProvider;

    if (currentProvider && !providerKeys.includes(currentProvider)) {
        context.logger.debug("buildUserSettingsResponse: provider not in configured providers, treat as unset", {
            currentProvider,
            providers: providerKeys
        });
        currentProvider = null;
    }

    const apiKey = context.userSettingsStore.getApiKey(currentProvider);
    const apiKeySet = Boolean(apiKey);

    let availableModels: string[] = [];

    if (currentProvider) {
        const modelEntry = context.config.models[currentProvider];

        if (!modelEntry) {
            throw new Error(`Unsupported provider: ${currentProvider}`);
        }

        if (modelEntry.availableModels.length > 0) {
            availableModels = [...modelEntry.availableModels].sort();
            context.logger.debug("buildUserSettingsResponse: use models from config.availableModels", {
                provider: currentProvider,
                modelCount: availableModels.length,
                firstModels: availableModels.slice(0, 5)
            });
        } else if (apiKey) {
            const client = createModelClientFromConfig({
                provider: modelEntry.provider,
                model: settings.currentModel || modelEntry.defaultModel || "model-for-listing",
                apiUrl: modelEntry.apiUrl,
                apiKey
            });

            availableModels = await client.listModels();
            availableModels.sort();
            context.logger.debug("buildUserSettingsResponse: models loaded from provider api", {
                provider: currentProvider,
                modelCount: availableModels.length,
                firstModels: availableModels.slice(0, 5)
            });
        }
    }

    let currentModel = settings.currentModel;
    if (currentModel && availableModels.length > 0 && !availableModels.includes(currentModel)) {
        context.logger.debug("buildUserSettingsResponse: model not in availableModels, treat as unset", {
            currentProvider,
            currentModel,
            modelCount: availableModels.length
        });
        currentModel = null;
    }

    return {
        providers: providerKeys,
        currentProvider,
        apiKeySet,
        currentModel,
        availableModels
    };
}

export function registerUserSettingsRoutes(context: HttpApiContext): void {
    registerApi(context.app, ApiGetUserSettings, async () => {
        context.logger.debug("getUserSettings: loading settings");

        const response = await buildUserSettingsResponse(context);

        context.logger.debug("getUserSettings: response prepared", {
            providers: response.providers,
            currentProvider: response.currentProvider,
            currentModel: response.currentModel,
            apiKeySet: response.apiKeySet,
            modelCount: response.availableModels.length,
            firstModels: response.availableModels.slice(0, 5)
        });

        return response;
    }, {
        onError: (error) => {
            const response = toErrorResponse(error);
            context.logger.error("getUserSettings: failed", {
                message: response.message
            });

            return {
                status: 400,
                body: response
            };
        }
    });

    registerApi(context.app, ApiUpsertUserSettings, async ({ body }) => {
        const provider = typeof body?.provider === "string" ? body.provider.trim().toLowerCase() : "";
        const model = typeof body?.model === "string" ? body.model.trim() : null;
        const apiKeyInput = typeof body?.apiKey === "string" ? body.apiKey.trim() : null;

        context.logger.debug("upsertUserSettings: request received", {
            provider,
            model,
            hasApiKeyInRequest: Boolean(apiKeyInput)
        });

        if (!provider) {
            throw new Error("provider is required");
        }

        if (!context.config.models[provider]) {
            throw new Error(`Unsupported provider: ${provider}`);
        }

        const current = context.userSettingsStore.read();
        const keepExistingModel = provider === current.currentProvider ? current.currentModel : null;
        const targetModel = model || keepExistingModel;

        context.userSettingsStore.update({
            currentProvider: provider,
            currentModel: targetModel
        });

        if (apiKeyInput !== null) {
            context.userSettingsStore.setApiKey(provider, apiKeyInput || null);
        }

        context.logger.info("upsertUserSettings: settings persisted", {
            currentProvider: provider,
            currentModel: targetModel,
            apiKeySet: Boolean(context.userSettingsStore.getApiKey(provider))
        });

        const response = await buildUserSettingsResponse(context);

        if (response.availableModels.length > 0 && response.currentModel && !response.availableModels.includes(response.currentModel)) {
            const fallbackModel = response.availableModels[0];
            context.userSettingsStore.update({ currentModel: fallbackModel });
            context.logger.debug("upsertUserSettings: current model corrected", {
                from: response.currentModel,
                to: fallbackModel
            });

            return buildUserSettingsResponse(context);
        }

        context.logger.debug("upsertUserSettings: response prepared", {
            currentProvider: response.currentProvider,
            currentModel: response.currentModel,
            apiKeySet: response.apiKeySet,
            modelCount: response.availableModels.length,
            firstModels: response.availableModels.slice(0, 5)
        });

        return response;
    }, {
        onError: (error) => {
            const response = toErrorResponse(error);
            context.logger.error("upsertUserSettings: failed", {
                message: response.message
            });

            return {
                status: 400,
                body: response
            };
        }
    });
}
