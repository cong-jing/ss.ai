/**
 * Embedding port shapes and types.
 *
 * Lives under `embedding/` so stage code and adapters share a single
 * source of truth, and so the rest of the pipeline can refer to
 * `MemoryEmbedding` without going through the central type grab-bag
 * that the old `memory/types.ts` had.
 */

/**
 * Result of an embedding request, plus the metadata that lets later
 * similarity checks decide whether two vectors are comparable.
 *
 * `provider`, `model`, `dim`, and `version` together form the
 * "embedding signature": vectors with different signatures live in
 * different latent spaces and must not be compared directly.
 *
 * `version` represents non-model factors (text preprocessing,
 * prompt wrapping, normalization strategy). Bump it whenever those
 * change even if the underlying model is unchanged.
 */
export interface MemoryEmbedding {
    vector: number[];
    provider: string;
    model: string;
    dim: number;
    version: number;
    createdAt: string;
}

/**
 * Minimal vendor-neutral input shape passed to a
 * {@link MemoryEmbeddingProvider}.
 */
export interface MemoryEmbedInput {
    text: string;
    /**
     * Free-form purpose tag, e.g. "memory.write.candidate" or
     * "memory.read.query". Adapters can ignore it; some providers
     * expose a similar concept (e.g. "task type") and may map it.
     */
    purpose: string;
    /**
     * Optional caller identity. Adapters use it to honour per-user
     * model assignments and credentials; omit when calling on
     * behalf of a system job (the adapter will fall back to default
     * config).
     */
    userId?: string;
}

/**
 * Output of a single embedding call. Adapters are responsible for
 * filling in all metadata fields; consumers should never have to
 * guess provider/model/dim/version.
 */
export interface MemoryEmbedResult {
    embedding: MemoryEmbedding;
    /** Optional token usage so the processor can log it. */
    usage?: {
        promptTokens?: number;
        totalTokens?: number;
    };
}

/**
 * Embedding port for the memory pipeline. Adapters that target a
 * real provider (Mistral, OpenAI, 閳? implement this interface.
 */
export interface MemoryEmbeddingProvider {
    embed(input: MemoryEmbedInput): Promise<MemoryEmbedResult>;
}
