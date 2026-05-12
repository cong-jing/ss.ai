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
}

export interface ModelGenerationInput {
    messages: RenderedMessage[];
    timeoutMs: number;
}

export interface ModelClient {
    generateNonStructured(input: ModelGenerationInput): Promise<string>;
    generateStructured(input: ModelGenerationInput): Promise<CommonRoleplayTurnOutput>;
    listModels(): Promise<string[]>;
}
