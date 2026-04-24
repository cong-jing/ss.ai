export type LogLevel = "debug" | "info" | "warn" | "error";

export interface Logger {
    debug(message: string, meta?: Record<string, unknown>): void;
    info(message: string, meta?: Record<string, unknown>): void;
    warn(message: string, meta?: Record<string, unknown>): void;
    error(message: string, meta?: Record<string, unknown>): void;
}

export interface AgentConfig {
    model: string;
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
}
