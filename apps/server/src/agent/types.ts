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
    prompt: string;
    history?: HistoryMessage[];
}

export interface ChatResponse {
    output: string;
    model: string;
    requestId: string;
}

export interface ModelClient {
    generate(input: {
        prompt: string;
        history?: HistoryMessage[];
        timeoutMs: number;
    }): Promise<string>;
    listModels(): Promise<string[]>;
}
