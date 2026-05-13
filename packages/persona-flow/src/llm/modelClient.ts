import type { CommonRoleplayTurnOutput } from "../prompt/commonRoleplayTurnOutput.js";
import type { RenderedMessage } from "../prompt/systemPromptBuilder.js";

export type GenerationMode = "non-structured" | "structured";

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

export interface ModelClientFactoryInput {
    provider: string;
    model: string;
    apiUrl: string;
    apiKey: string;
}

export type ModelClientFactory = (input: ModelClientFactoryInput) => ModelClient;
