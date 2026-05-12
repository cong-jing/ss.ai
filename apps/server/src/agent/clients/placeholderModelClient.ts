import type { ModelClient, ModelGenerationInput, ModelStreamCallbacks, ModelStreamResult } from "../types.js";

export class PlaceholderModelClient implements ModelClient {
    async generateNonStructured(input: ModelGenerationInput) {
        const lastUser = [...input.messages].reverse().find(m => m.role === "user");
        return {
            output: `TODO: replace PlaceholderModelClient with real LLM API call. Prompt: ${lastUser?.content ?? ""}`,
            toolCalls: [],
        };
    }

    async generateNonStructuredStream(input: ModelGenerationInput, callbacks?: ModelStreamCallbacks): Promise<ModelStreamResult> {
        const result = await this.generateNonStructured(input);
        callbacks?.onTextDelta?.(result.output);
        return {
            output: result.output,
            toolCalls: [],
            completed: true,
            finishReason: "stop",
        };
    }

    async generateStructured(input: ModelGenerationInput) {
        const lastUser = [...input.messages].reverse().find(m => m.role === "user");
        return {
            structuredOutput: {
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
            },
            toolCalls: [],
        };
    }

    async listModels(): Promise<string[]> {
        return ["placeholder-model"];
    }
}