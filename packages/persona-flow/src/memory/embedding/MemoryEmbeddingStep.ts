import type { MemoryCandidateRecord } from "../candidate/candidateTypes.js";
import type { MemoryPipelineLogger } from "../logging/MemoryPipelineLogger.js";
import type {
    MemoryEmbedResult,
    MemoryEmbeddingProvider,
} from "./embeddingPorts.js";

/**
 * Outcome of the embedding stage for a single candidate.
 *
 * Either the provider returned a usable result (`ok: true` and
 * `result` is set), or it failed (`ok: false` and `error` is set).
 * The processor never has to inspect provider-specific error types
 * because they are flattened into a string message at this boundary and
 * the processor maps that to a `embedding_failed` outcome.
 */
export type MemoryEmbeddingStepOutcome =
    | { ok: true; result: MemoryEmbedResult }
    | { ok: false; error: Error };

/**
 * Wraps {@link MemoryEmbeddingProvider} with try/catch + structured
 * logging so the processor only sees a clean
 * {@link MemoryEmbeddingStepOutcome}.
 *
 * Why it is its own class:
 *  - Keeps the processor's main flow free of `try / await embed /
 *    catch / log / synthesise outcome` boilerplate.
 *  - Gives logging a single point of truth (`embeddingRequested`,
 *    `embeddingCompleted`, `embeddingFailed` always fire together).
 *  - Lets future cancellation / retry / bulk-processing logic live here
 *    without re-shaping the processor.
 */
export class MemoryEmbeddingStep {
    constructor(
        private readonly provider: MemoryEmbeddingProvider,
        private readonly logger: MemoryPipelineLogger,
    ) { }

    async embed(candidate: MemoryCandidateRecord): Promise<MemoryEmbeddingStepOutcome> {
        this.logger.embeddingRequested({ candidateId: candidate.id });
        try {
            const result = await this.provider.embed({
                text: candidate.text,
                purpose: "memory.write.candidate",
                userId: candidate.source.userId,
            });
            this.logger.embeddingCompleted({
                candidateId: candidate.id,
                provider: result.embedding.provider,
                model: result.embedding.model,
                dim: result.embedding.dim,
                version: result.embedding.version,
            });
            return { ok: true, result };
        } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            this.logger.embeddingFailed({
                candidateId: candidate.id,
                error: err.message,
            });
            return { ok: false, error: err };
        }
    }
}
