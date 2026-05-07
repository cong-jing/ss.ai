import type { RenderedMessage } from "@ss-ai/persona-flow";
import { ModelClient } from "../types.js";

export class PlaceholderModelClient implements ModelClient {
    async generate(input: {
        messages: RenderedMessage[];
        timeoutMs: number;
    }): Promise<string> {
        const lastUser = [...input.messages].reverse().find(m => m.role === "user");
        return `TODO: replace PlaceholderModelClient with real LLM API call. Prompt: ${lastUser?.content ?? ""}`;
    }

    async listModels(): Promise<string[]> {
        return ["placeholder-model"];
    }
}