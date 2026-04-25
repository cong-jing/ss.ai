import { ModelClient } from "../types";

export class PlaceholderModelClient implements ModelClient {
    async generate(input: {
        prompt: string;
        sessionId?: string;
        timeoutMs: number;
    }): Promise<string> {
        const sessionPart = input.sessionId ? ` [session=${input.sessionId}]` : "";
        return `TODO: replace PlaceholderModelClient with real LLM API call.${sessionPart} Prompt: ${input.prompt}`;
    }

    async listModels(): Promise<string[]> {
        return ["placeholder-model"];
    }
}