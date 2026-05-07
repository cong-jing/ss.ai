import type { RenderedMessage } from "@ss-ai/persona-flow";
export type { RenderedMessage };

export interface AgentConfig {
    provider: string;
    apiUrl: string;
    model: string;
    apiKey: string;
    timeoutMs: number;
    maxRetries: number;
}

export interface HistoryMessage {
    role: "user" | "assistant";
    content: string;
}

export interface ChatRequest {
    messages: RenderedMessage[];
}

export interface ChatResponse {
    output: string;
    model: string;
    requestId: string;
}

export interface ModelClient {
    generate(input: {
        messages: RenderedMessage[];
        timeoutMs: number;
    }): Promise<string>;
    listModels(): Promise<string[]>;
}
