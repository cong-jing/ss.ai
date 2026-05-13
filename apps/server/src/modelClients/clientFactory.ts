import type { ModelClient, ModelClientFactoryInput } from "@ss-ai/persona-flow";
import { MistralModelClient } from "./mistral/mistralModelClient.js";

export function createModelClientFromConfig(config: ModelClientFactoryInput): ModelClient {
    const normalizedProvider = config.provider.toLowerCase();

    if (normalizedProvider === "mistral" || normalizedProvider === "mistral.ai") {
        return new MistralModelClient({
            apiKey: config.apiKey,
            apiUrl: config.apiUrl,
            model: config.model
        });
    }

    throw new Error(`Unsupported model provider: ${config.provider}`);
}
