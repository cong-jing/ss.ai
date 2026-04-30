import { ModelClient, HistoryMessage } from "../types.js";

export class PlaceholderModelClient implements ModelClient {
    async generate(input: {
        prompt: string;
        history?: HistoryMessage[];
        timeoutMs: number;
    }): Promise<string> {
        return `TODO: replace PlaceholderModelClient with real LLM API call. Prompt: ${input.prompt}`;
    }

    async listModels(): Promise<string[]> {
        return ["placeholder-model"];
    }
}