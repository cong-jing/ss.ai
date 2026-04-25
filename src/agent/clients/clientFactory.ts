import { AgentConfig, ModelClient } from "../types";
import { MistralModelClient } from "./mistralModelClient";

export function createModelClientFromConfig(config: Pick<AgentConfig, "provider" | "apiKey" | "apiUrl" | "model">): ModelClient {
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
