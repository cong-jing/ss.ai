import type { RenderedMessage } from "../prompt/promptTypes.js";
import type { ModelToolChoice, ModelToolDefinition } from "./tools/modelTool.js";

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
    /**
     * Parsed tool-call arguments value. Provider adapters MUST normalize
     * provider-specific representations (e.g. Mistral/OpenAI send arguments as
     * a JSON string) into a parsed JavaScript value before returning. Consumers
     * (model calls, tool dispatchers) can therefore validate this directly with
     * a Zod schema without re-handling string vs. object cases.
     *
     * Undefined when the provider sent no arguments, or when raw text was
     * present but failed to JSON-parse (see {@link argumentsRaw}).
     */
    arguments?: unknown;
    /**
     * Raw arguments text exactly as emitted by the provider, preserved even
     * when JSON parsing fails so prompt logs and debug tools can inspect the
     * original payload. Provider adapters set this when arguments arrived as a
     * string; they may leave it unset when arguments were already structured.
     */
    argumentsRaw?: string;
}

/**
 * Provider-neutral incremental tool-call delta emitted during streaming.
 *
 * Providers (e.g. Mistral/OpenAI) typically emit tool-call updates as
 * fragmented chunks identified by `index`. Downstream consumers merge
 * them into a complete {@link ModelToolCall} but may also peek at
 * `argumentsDelta` to drive token-level previews.
 */
export interface ModelToolCallDelta {
    id?: string;
    type?: string;
    index?: number;
    functionNameDelta?: string;
    argumentsDelta?: string;
    raw?: unknown;
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
    onToolCallDelta?: (delta: ModelToolCallDelta) => void;
    onToolCall?: (toolCall: ModelToolCall) => void;
}

export interface ModelStreamResult {
    /**
     * Raw text accumulated from the provider stream. For text/tool-call
     * responses this is the assistant message text. For structured
     * (`response_format: json_schema`) responses this is the raw JSON
     * text emitted by the provider; the parsed object is exposed
     * separately via {@link ModelStreamResult.structuredOutput}.
     */
    output?: string;
    /**
     * Parsed object from a structured (`response_format: json_schema`)
     * response. Adapters parse `output` before returning so callers
     * have a uniform place to read the final structured result, in
     * the same way `ModelGenerationResult.structuredOutput` works
     * for non-streaming calls.
     */
    structuredOutput?: unknown;
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
