import type {
    ModelGenerationInput,
    ModelStructuredResult,
    ModelToolCall,
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

export function extractStructuredResult(response: unknown): ModelStructuredResult {
    const responseWithChoices = response as {
        choices?: Array<{
            message?: unknown;
        }>;
    };

    const message = responseWithChoices.choices?.[0]?.message;
    return {
        structuredOutput: extractStructuredOutput(response),
        toolCalls: extractToolCallsFromMessage(message),
        usage: extractUsage(response),
    };
}
