import type { ModelEmbedResult, ModelUsage } from "@ss-ai/persona-flow";

/**
 * Pure transforms for the Mistral embeddings endpoint.
 *
 * Kept separate from the client class so we can unit-test request shape,
 * response parsing, and error mapping without standing up the SDK or the
 * dynamic-import dance. The client method is then a thin wrapper that wires
 * an already-constructed Mistral SDK client to these helpers.
 */

/** Shape of the Mistral SDK's `embeddings.create` request that we use. */
export interface MistralEmbeddingRequest {
    model: string;
    inputs: string[];
}

/** Minimal shape of the SDK's response that we read from. */
export interface MistralEmbeddingResponseLike {
    model?: unknown;
    data?: unknown;
    usage?: unknown;
}

/**
 * Build the Mistral SDK request body from a provider-neutral input. Kept as a
 * function (not inlined) so the test suite can pin the exact request shape we
 * send to the provider — drift between our contract and the SDK's expected
 * fields is the most common silent breakage.
 */
export function buildMistralEmbeddingRequest(model: string, inputs: string[]): MistralEmbeddingRequest {
    if (!model || !model.trim()) {
        throw new Error("Mistral embed: model is required");
    }
    if (!Array.isArray(inputs) || inputs.length === 0) {
        throw new Error("Mistral embed: inputs must contain at least one text");
    }
    return {
        model,
        inputs,
    };
}

interface RawEmbeddingDataEntry {
    embedding?: unknown;
    index?: unknown;
}

interface RawEmbeddingUsage {
    promptTokens?: unknown;
    totalTokens?: unknown;
    completionTokens?: unknown;
}

function isNumberArray(value: unknown): value is number[] {
    return Array.isArray(value) && value.every((v) => typeof v === "number" && Number.isFinite(v));
}

function extractEmbeddingUsage(raw: unknown): ModelUsage | undefined {
    if (!raw || typeof raw !== "object") return undefined;
    const usage = raw as RawEmbeddingUsage;
    const promptTokens = typeof usage.promptTokens === "number" ? usage.promptTokens : undefined;
    const completionTokens = typeof usage.completionTokens === "number" ? usage.completionTokens : undefined;
    const totalTokens = typeof usage.totalTokens === "number" ? usage.totalTokens : undefined;
    if (promptTokens === undefined && completionTokens === undefined && totalTokens === undefined) {
        return { raw };
    }
    return {
        ...(promptTokens !== undefined ? { promptTokens } : {}),
        ...(completionTokens !== undefined ? { completionTokens } : {}),
        ...(totalTokens !== undefined ? { totalTokens } : {}),
        raw,
    };
}

/**
 * Convert the Mistral SDK's `EmbeddingResponse` to a `ModelEmbedResult`,
 * enforcing the invariants downstream code relies on:
 *
 *  - one vector per requested input, in the original order;
 *  - every vector is a finite number[];
 *  - response declares a model name we can record in metadata.
 *
 * Throws an Error with a clear message if any invariant is violated. Callers
 * are responsible for wrapping/categorizing that error if they need a typed
 * error class.
 */
export function transformMistralEmbeddingResponse(
    response: MistralEmbeddingResponseLike,
    expectedCount: number,
    requestedModel: string,
): ModelEmbedResult {
    if (!response || typeof response !== "object") {
        throw new Error("Mistral embed: response is not an object");
    }
    const data = response.data;
    if (!Array.isArray(data)) {
        throw new Error("Mistral embed: response.data is not an array");
    }
    if (data.length !== expectedCount) {
        throw new Error(`Mistral embed: response returned ${data.length} embeddings but ${expectedCount} were requested`);
    }

    // Sort by `index` when present so we are robust to providers returning
    // entries out of request order. When `index` is missing, trust the array
    // order — this is the documented behaviour for the Mistral SDK today.
    //
    // We also defensively enforce the function's contract: every index must
    // be a unique integer in `[0, expectedCount)`. Without this check a
    // misbehaving / future provider could silently mis-pair inputs with
    // output vectors, and downstream callers (recorder, commit service)
    // would store wrong-text embeddings without a single error.
    const entries: Array<{ vector: number[]; index: number }> = [];
    const seenIndices = new Set<number>();
    for (let i = 0; i < data.length; i += 1) {
        const entry = data[i] as RawEmbeddingDataEntry;
        const vector = entry?.embedding;
        if (!isNumberArray(vector)) {
            throw new Error(`Mistral embed: response.data[${i}].embedding is not a finite number array`);
        }
        const rawIndex = entry?.index;
        const index = typeof rawIndex === "number" ? rawIndex : i;
        if (!Number.isInteger(index) || index < 0 || index >= expectedCount) {
            throw new Error(
                `Mistral embed: response.data[${i}].index "${String(rawIndex)}" is out of range [0, ${expectedCount})`,
            );
        }
        if (seenIndices.has(index)) {
            throw new Error(`Mistral embed: response.data[${i}].index ${index} is duplicated across entries`);
        }
        seenIndices.add(index);
        entries.push({ vector, index });
    }
    entries.sort((a, b) => a.index - b.index);

    const responseModel = typeof response.model === "string" && response.model.trim()
        ? response.model
        : requestedModel;

    return {
        vectors: entries.map((entry) => entry.vector),
        model: responseModel,
        usage: extractEmbeddingUsage(response.usage),
    };
}

/**
 * SDK-shape client used by `runMistralEmbed`. Defined here (rather than
 * imported from the Mistral SDK) so tests can pass a tiny fake object that
 * satisfies just this method without pulling in the real SDK.
 */
export interface MistralEmbeddingsSdkLike {
    embeddings: {
        create(request: MistralEmbeddingRequest): Promise<MistralEmbeddingResponseLike>;
    };
}

/**
 * Thin orchestrator: validates input → calls SDK → transforms response.
 * Errors from the SDK are wrapped with a stable prefix so consumers can
 * recognize provider-side failures separately from input validation errors.
 */
export async function runMistralEmbed(
    sdkClient: MistralEmbeddingsSdkLike,
    model: string,
    inputs: string[],
): Promise<ModelEmbedResult> {
    const request = buildMistralEmbeddingRequest(model, inputs);
    let response: MistralEmbeddingResponseLike;
    try {
        response = await sdkClient.embeddings.create(request);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Mistral embed: provider call failed: ${message}`);
    }
    return transformMistralEmbeddingResponse(response, inputs.length, model);
}
