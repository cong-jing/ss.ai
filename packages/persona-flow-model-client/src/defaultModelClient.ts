import { ModelClient, ModelGenerationInput, ModelGenerationResult, ModelStreamCallbacks, ModelStreamResult, ModelStructuredResult } from "@ss-ai/persona-flow";
import { provide } from "vue";
import { MistralModelClient } from "./mistral/mistralModelClient.js";

export interface ProviderConfig {
    provider: string;
    apiUrl: string;
}

export class DefaultModelClient implements ModelClient {

    private _maxRetries: number = 0;
    private _timeoutMs: number = 0;
    private _providerConfig: Record<string, ProviderConfig>;

    constructor(configs: {
        providerConfigs: Record<string, ProviderConfig>;
        timeoutMs: number;
        maxRetries?: number;
    }) {
        this._providerConfig = configs.providerConfigs;
        this._timeoutMs = configs.timeoutMs;
        this._maxRetries = configs.maxRetries ?? 0;
    }

    generateNonStructured(input: ModelGenerationInput): Promise<ModelGenerationResult> {
        const normalizedProvider = input.provider.toLowerCase();
        const client = this.getModelAdapter(normalizedProvider, input.apiKey);
        return client.generateNonStructured(input);
    }
    generateNonStructuredStream(input: ModelGenerationInput, callbacks?: ModelStreamCallbacks): Promise<ModelStreamResult> {
        const normalizedProvider = input.provider.toLowerCase();
        const client = this.getModelAdapter(normalizedProvider, input.apiKey);
        return client.generateNonStructuredStream(input, callbacks);
    }
    generateStructured(input: ModelGenerationInput): Promise<ModelStructuredResult> {
        const normalizedProvider = input.provider.toLowerCase();
        const client = this.getModelAdapter(normalizedProvider, input.apiKey);
        return client.generateStructured(input);
    }
    listModels(provider: string, apiKey: string): Promise<string[]> {
        const client = this.getModelAdapter(provider, apiKey);
        return client.listModels(provider, apiKey);
    }

    private getModelAdapter(provider: string, apiKey: string): ModelClient {
        const normalizedProvider = provider.toLowerCase();
        const config = this.getProviderConfig(provider);

        if (normalizedProvider === "mistral" || normalizedProvider === "mistral.ai") {
            return new MistralModelClient({
                apiKey: apiKey,
                apiUrl: config.apiUrl,
                timeoutMs: this._timeoutMs,
                maxRetries: this._maxRetries,
            });
        }

        throw new Error(`Unsupported model provider: ${config.provider}`);
    }

    private getProviderConfig(providerName: string): ProviderConfig {
        const config = this._providerConfig[providerName.toLowerCase()];
        if (!config) {
            throw new Error(`No configuration found for provider: ${providerName}`);
        }
        return config;
    }
}