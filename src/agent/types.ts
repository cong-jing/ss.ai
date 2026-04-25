export interface AgentConfig {
    provider: string;
    apiUrl: string;
    model: string;
    apiKey: string;
    timeoutMs: number;
    maxRetries: number;
}

export interface ChatRequest {
    prompt: string;
    sessionId?: string;
}

export interface ChatResponse {
    output: string;
    model: string;
    requestId: string;
}

export interface ModelClient {
    generate(input: {
        prompt: string;
        sessionId?: string;
        timeoutMs: number;
    }): Promise<string>;
    listModels(): Promise<string[]>;
}
