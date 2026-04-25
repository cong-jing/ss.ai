import { AgentService, createModelClientFromConfig } from "../../agent";
import type { Express } from "express";
import { RuntimeConfig, RuntimeModelEntry } from "../../util/config";
import { Logger } from "../../util/logger";
import { UserSettingsStore } from "../userSettingsStore";
import type { ErrorResponse } from "../../../shared/contracts/httpApi";

export interface HttpApiContext {
    app: Express;
    logger: Logger;
    config: RuntimeConfig;
    userSettingsStore: UserSettingsStore;
    createAgentServiceFromUserSettings: () => AgentService;
}

function getModelEntry(models: Record<string, RuntimeModelEntry>, provider: string): RuntimeModelEntry {
    const modelEntry = models[provider];
    if (!modelEntry) {
        throw new Error(`Unsupported provider: ${provider}`);
    }

    return modelEntry;
}

export function toErrorResponse(error: unknown): ErrorResponse {
    return {
        message: error instanceof Error ? error.message : "Unknown error"
    };
}

export function createAgentServiceFactory(
    userSettingsStore: UserSettingsStore,
    models: Record<string, RuntimeModelEntry>,
    config: RuntimeConfig
): () => AgentService {
    return () => {
        const settings = userSettingsStore.read();
        const providerKey = settings.currentProvider;
        if (!providerKey) {
            throw new Error("provider is not selected");
        }

        const modelEntry = getModelEntry(models, providerKey);
        const apiKey = userSettingsStore.getApiKey(providerKey);
        if (!apiKey) {
            throw new Error(`apiKey is not configured for provider: ${providerKey}`);
        }

        const model = settings.currentModel;
        if (!model) {
            throw new Error("model is not selected");
        }

        const runtimeAgentConfig = {
            provider: modelEntry.provider,
            apiUrl: modelEntry.apiUrl,
            model,
            apiKey,
            timeoutMs: config.agent.timeoutMs,
            maxRetries: config.agent.maxRetries
        };

        return new AgentService(runtimeAgentConfig, {
            modelClient: createModelClientFromConfig(runtimeAgentConfig)
        });
    };
}
