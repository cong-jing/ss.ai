import type { ModelClient, ModelGenerationInput } from "../types.js";

export class PlaceholderModelClient implements ModelClient {
    async generateNonStructured(input: ModelGenerationInput): Promise<string> {
        const lastUser = [...input.messages].reverse().find(m => m.role === "user");
        return `TODO: replace PlaceholderModelClient with real LLM API call. Prompt: ${lastUser?.content ?? ""}`;
    }

    async generateStructured(input: ModelGenerationInput) {
        const lastUser = [...input.messages].reverse().find(m => m.role === "user");
        return {
            action: "reply" as const,
            replyText: `TODO: structured mode placeholder. Prompt: ${lastUser?.content ?? ""}`,
            control: {
                summarizeSuggested: false,
                summarizeReason: "todo",
                summarizeUrgency: "none" as const,
            },
            skip: {
                reasonCode: "none" as const,
                reason: "",
            },
        };
    }

    async listModels(): Promise<string[]> {
        return ["placeholder-model"];
    }
}