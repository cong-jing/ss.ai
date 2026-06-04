import type { RenderedMessage } from "../prompt/promptTypes.js";
import type { ModelToolChoice, ModelToolDefinition } from "./tools/modelTool.js";

export type GenerationMode = "non-structured" | "structured";

export interface StructuredOutputSchema {
    type: "json_schema";
    jsonSchema: {
        name: string;
        description?: string | null;
        schemaDefinition: Record<string, unknown>;
        strict?: boolean;
    };
}

export interface ModelGenerationInput {
    provider: string;
    model: string;
    /** Encrypted API key payload passed through the pipeline. */
    encryptedApiKey: string;
    messages: RenderedMessage[];
    structuredOutputSchema?: StructuredOutputSchema;
    tools?: ModelToolDefinition[];
    toolChoice?: ModelToolChoice;
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
    output?: string;
    structuredOutput?: unknown;
    toolCalls: ModelToolCall[];
    usage?: ModelUsage;
}

export interface ModelStreamCallbacks {
    onTextDelta?: (delta: string) => void;
    onToolCall?: (toolCall: ModelToolCall) => void;
}

export interface ModelStreamResult {
    output?: string;
    toolCalls: ModelToolCall[];
    usage?: ModelUsage;
    completed: boolean;
    finishReason?: string;
}

export interface ModelClient {
    generate(input: ModelGenerationInput): Promise<ModelGenerationResult>;
    generateStream(input: ModelGenerationInput, callbacks?: ModelStreamCallbacks): Promise<ModelStreamResult>;
    listModels(provider: string, encryptedApiKey: string): Promise<string[]>;
}

export interface ModelClientFactoryInput {
    provider: string;
    model: string;
    apiUrl: string;
    encryptedApiKey: string;
    timeoutMs: number;
    maxRetries: number;
}

export type ModelClientFactory = (input: ModelClientFactoryInput) => ModelClient;
