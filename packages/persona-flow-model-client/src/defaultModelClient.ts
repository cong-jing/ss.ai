import {
    ModelClient,
    ModelGenerationResult,
    ModelGenerationInput,
    ModelStreamCallbacks,
    ModelStreamResult,
    PersonaFlowLogger
} from "@ss-ai/persona-flow";
import { MistralModelClient } from "./mistral/mistralModelClient.js";
import { ModelAdapter } from "./modelAdapter.js";

export interface ProviderConfig {
    provider: string;
    apiUrl: string;
}

export class DefaultModelClient implements ModelClient {
    private readonly _logger?: PersonaFlowLogger;
    private _maxRetries: number = 0;
    private _timeoutMs: number = 0;
    private _providerConfig: Record<string, ProviderConfig>;

    constructor(configs: {
        providerConfigs: Record<string, ProviderConfig>;
        timeoutMs: number;
        maxRetries?: number;
        logger?: PersonaFlowLogger;
    }) {
        this._providerConfig = configs.providerConfigs;
        this._timeoutMs = configs.timeoutMs;
        this._maxRetries = configs.maxRetries ?? 0;
        this._logger = configs.logger;
        this._logger?.info(`Initialized DefaultModelClient with providers: ${Object.keys(this._providerConfig).join(", ")}`);
    }

    private decryptApiKey(encryptedApiKey: string): string {
        // Placeholder for future real decryption.
        return encryptedApiKey;
    }

    generate(input: ModelGenerationInput): Promise<ModelGenerationResult> {
        const normalizedProvider = input.provider.toLowerCase();
        const client = this.getModelAdapter(normalizedProvider, input.encryptedApiKey);
        return client.generate(input);
    }
    generateStream(input: ModelGenerationInput, callbacks?: ModelStreamCallbacks): Promise<ModelStreamResult> {
        const normalizedProvider = input.provider.toLowerCase();
        const client = this.getModelAdapter(normalizedProvider, input.encryptedApiKey);
        return client.generateStream(input, callbacks);
    }
    listModels(provider: string, encryptedApiKey: string): Promise<string[]> {

        const client = this.getModelAdapter(provider, encryptedApiKey);
        return client.listModels();
    }

    private getModelAdapter(provider: string, encryptedApiKey: string): ModelAdapter {
        const apiKey = this.decryptApiKey(encryptedApiKey);

        const normalizedProvider = provider.toLowerCase();
        const config = this.getProviderConfig(provider);

        if (normalizedProvider === "mistral" || normalizedProvider === "mistral.ai") {
            return new MistralModelClient({
                apiKey,
                apiUrl: config.apiUrl,
                timeoutMs: this._timeoutMs,
                maxRetries: this._maxRetries,
                logger: this._logger,
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
