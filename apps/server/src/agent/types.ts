import type { CommonRoleplayTurnOutput, RenderedMessage } from "@ss-ai/persona-flow";
export type { RenderedMessage };

export type GenerationMode = "non-structured" | "structured";

export interface AgentConfig {
    provider: string;
    apiUrl: string;
    model: string;
    apiKey: string;
    timeoutMs: number;
    maxRetries: number;
}

export interface ChatRequest {
    messages: RenderedMessage[];
    mode?: GenerationMode;
}

export interface ChatResponse {
    output: string;
    model: string;
    requestId: string;
    mode: GenerationMode;
    structuredOutput?: CommonRoleplayTurnOutput;
    toolCalls?: ModelToolCall[];
    usage?: ModelUsage;
    streamCompleted?: boolean;
    streamFinishReason?: string;
}

export interface ModelGenerationInput {
    messages: RenderedMessage[];
    timeoutMs: number;
}

export interface ModelToolCall {
    id?: string;
    type?: string;
    index?: number;
    functionName?: string;
    arguments?: unknown;
}

export interface ModelUsage {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
    raw?: unknown;
}

export interface ModelGenerationResult {
    output: string;
    toolCalls: ModelToolCall[];
    usage?: ModelUsage;
}

export interface ModelStructuredResult {
    structuredOutput: CommonRoleplayTurnOutput;
    toolCalls: ModelToolCall[];
    usage?: ModelUsage;
}

export interface ModelStreamCallbacks {
    onTextDelta?: (delta: string) => void;
    onToolCall?: (toolCall: ModelToolCall) => void;
}

export interface ModelStreamResult {
    output: string;
    toolCalls: ModelToolCall[];
    usage?: ModelUsage;
    completed: boolean;
    finishReason?: string;
}

export interface ModelClient {
    generateNonStructured(input: ModelGenerationInput): Promise<ModelGenerationResult>;
    generateNonStructuredStream(input: ModelGenerationInput, callbacks?: ModelStreamCallbacks): Promise<ModelStreamResult>;
    generateStructured(input: ModelGenerationInput): Promise<ModelStructuredResult>;
    listModels(): Promise<string[]>;
}
