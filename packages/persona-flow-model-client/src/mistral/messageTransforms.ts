import type {
    ModelGenerationInput,
    ModelToolCall,
    ModelToolCallDelta,
    ModelUsage,
} from "@ss-ai/persona-flow";

export function toSdkMessages(input: ModelGenerationInput) {
    return input.messages.map(m => ({
        role: m.role as "user" | "assistant" | "system",
        content: m.content,
    }));
}

export function extractText(response: unknown): string {
    const responseWithChoices = response as {
        choices?: Array<{
            message?: {
                content?: unknown;
            };
        }>;
    };

    const content = responseWithChoices.choices?.[0]?.message?.content;

    if (typeof content === "string" && content.trim()) {
        return content;
    }

    if (Array.isArray(content)) {
        const text = content
            .map((item) => {
                if (typeof item === "string") {
                    return item;
                }

                if (item && typeof item === "object" && "text" in item && typeof item.text === "string") {
                    return item.text;
                }

                return "";
            })
            .join("")
            .trim();

        if (text) {
            return text;
        }
    }

    throw new Error("Mistral response did not contain text content.");
}

export function isMistralMessageContentEmpty(message: unknown): boolean {
    if (!message || typeof message !== "object") {
        return true;
    }

    const content = (message as { content?: unknown }).content;
    if (content === undefined || content === null) {
        return true;
    }

    if (typeof content === "string") {
        return !content.trim();
    }

    if (Array.isArray(content)) {
        return content.length === 0 || content.every(isEmptyTextContentPart);
    }

    return false;
}

function isEmptyTextContentPart(item: unknown): boolean {
    if (typeof item === "string") {
        return !item.trim();
    }

    if (item && typeof item === "object" && "text" in item && typeof (item as { text?: unknown }).text === "string") {
        return !(item as { text: string }).text.trim();
    }

    return false;
}

export function extractStructuredOutput(response: unknown): unknown {
    const responseWithChoices = response as {
        choices?: Array<{
            message?: {
                parsed?: unknown;
                content?: unknown;
            };
        }>;
    };

    const message = responseWithChoices.choices?.[0]?.message;
    const parsedCandidate = message?.parsed;
    if (parsedCandidate !== undefined) {
        return parsedCandidate;
    }

    const content = message?.content;
    if (typeof content === "string" && content.trim()) {
        return JSON.parse(content);
    }

    throw new Error("Mistral structured response did not contain parsed or JSON content.");
}

export function extractTextDelta(content: unknown): string {
    if (typeof content === "string") {
        return content;
    }

    if (Array.isArray(content)) {
        return content
            .map((item) => {
                if (typeof item === "string") {
                    return item;
                }

                if (
                    item
                    && typeof item === "object"
                    && "type" in item
                    && (item as { type?: unknown }).type === "text"
                    && "text" in item
                    && typeof (item as { text?: unknown }).text === "string"
                ) {
                    return (item as { text: string }).text;
                }

                if (item && typeof item === "object" && "text" in item && typeof (item as { text?: unknown }).text === "string") {
                    return (item as { text: string }).text;
                }

                return "";
            })
            .join("");
    }

    return "";
}

export function normalizeToolCall(toolCall: unknown): ModelToolCall {
    if (!toolCall || typeof toolCall !== "object") {
        return {};
    }

    const value = toolCall as {
        id?: unknown;
        type?: unknown;
        index?: unknown;
        function?: {
            name?: unknown;
            arguments?: unknown;
        };
    };

    return {
        id: typeof value.id === "string" ? value.id : undefined,
        type: typeof value.type === "string" ? value.type : undefined,
        index: typeof value.index === "number" ? value.index : undefined,
        functionName: typeof value.function?.name === "string" ? value.function.name : undefined,
        arguments: value.function?.arguments,
    };
}

export function extractToolCallsFromMessage(message: unknown): ModelToolCall[] {
    if (!message || typeof message !== "object") {
        return [];
    }

    const rawToolCalls = (message as { toolCalls?: unknown; tool_calls?: unknown }).toolCalls
        ?? (message as { tool_calls?: unknown }).tool_calls;
    if (!Array.isArray(rawToolCalls)) {
        return [];
    }

    return rawToolCalls.map(normalizeToolCall);
}

export function extractUsage(response: unknown): ModelUsage | undefined {
    if (!response || typeof response !== "object") {
        return undefined;
    }

    const usage = (response as {
        usage?: {
            promptTokens?: unknown;
            completionTokens?: unknown;
            totalTokens?: unknown;
            prompt_tokens?: unknown;
            completion_tokens?: unknown;
            total_tokens?: unknown;
        };
    }).usage;

    if (!usage || typeof usage !== "object") {
        return undefined;
    }

    const normalized: ModelUsage = {
        promptTokens: typeof usage.promptTokens === "number"
            ? usage.promptTokens
            : (typeof usage.prompt_tokens === "number" ? usage.prompt_tokens : undefined),
        completionTokens: typeof usage.completionTokens === "number"
            ? usage.completionTokens
            : (typeof usage.completion_tokens === "number" ? usage.completion_tokens : undefined),
        totalTokens: typeof usage.totalTokens === "number"
            ? usage.totalTokens
            : (typeof usage.total_tokens === "number" ? usage.total_tokens : undefined),
        raw: usage,
    };

    if (
        normalized.promptTokens === undefined
        && normalized.completionTokens === undefined
        && normalized.totalTokens === undefined
    ) {
        return { raw: usage };
    }

    return normalized;
}

/**
 * Per-tool-call accumulator used while consuming a provider stream.
 *
 * Mistral and other OpenAI-compatible providers send tool-call updates as
 * fragmented deltas keyed by `index`. We merge them here so the final
 * `arguments` string can be JSON-parsed downstream.
 */
export interface ToolCallAccumulator {
    index?: number;
    id?: string;
    type?: string;
    functionName?: string;
    argumentsBuffer: string;
}

export function normalizeStreamToolCallDeltas(delta: unknown): ModelToolCallDelta[] {
    if (!delta || typeof delta !== "object") {
        return [];
    }
    const rawToolCalls = (delta as { toolCalls?: unknown; tool_calls?: unknown }).toolCalls
        ?? (delta as { tool_calls?: unknown }).tool_calls;
    if (!Array.isArray(rawToolCalls)) {
        return [];
    }

    return rawToolCalls.map(normalizeStreamToolCallDelta);
}

function normalizeStreamToolCallDelta(raw: unknown): ModelToolCallDelta {
    if (!raw || typeof raw !== "object") {
        return { raw };
    }
    const value = raw as {
        id?: unknown;
        type?: unknown;
        index?: unknown;
        function?: {
            name?: unknown;
            name_delta?: unknown;
            arguments?: unknown;
            arguments_delta?: unknown;
        };
    };
    const fn = value.function;
    const functionNameDelta = typeof fn?.name === "string"
        ? fn.name
        : (typeof fn?.name_delta === "string" ? fn.name_delta : undefined);
    const argumentsCandidate = fn?.arguments ?? fn?.arguments_delta;
    const argumentsDelta = typeof argumentsCandidate === "string"
        ? argumentsCandidate
        : (argumentsCandidate !== undefined ? JSON.stringify(argumentsCandidate) : undefined);

    return {
        ...(typeof value.id === "string" ? { id: value.id } : {}),
        ...(typeof value.type === "string" ? { type: value.type } : {}),
        ...(typeof value.index === "number" ? { index: value.index } : {}),
        ...(functionNameDelta !== undefined ? { functionNameDelta } : {}),
        ...(argumentsDelta !== undefined ? { argumentsDelta } : {}),
        raw,
    };
}

export function accumulateToolCallDelta(
    accumulators: Map<number, ToolCallAccumulator>,
    delta: ModelToolCallDelta,
): ToolCallAccumulator {
    const key = typeof delta.index === "number" ? delta.index : 0;
    let acc = accumulators.get(key);
    if (!acc) {
        acc = { index: typeof delta.index === "number" ? delta.index : undefined, argumentsBuffer: "" };
        accumulators.set(key, acc);
    }
    if (delta.id) acc.id = delta.id;
    if (delta.type) acc.type = delta.type;
    if (delta.functionNameDelta) {
        acc.functionName = (acc.functionName ?? "") + delta.functionNameDelta;
    }
    if (delta.argumentsDelta) {
        acc.argumentsBuffer += delta.argumentsDelta;
    }
    return acc;
}
