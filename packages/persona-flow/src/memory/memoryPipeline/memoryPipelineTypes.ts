/**
 * Cross-cutting types and ports for the memory pipeline.
 *
 * These types are shared by every stage (candidate recording,
 * embedding, ranking, decision, persistence). Keeping them in one
 * small file means each step file only has to import the
 * step-specific shapes plus this module — no central `ports.ts`
 * grab-bag that hides which interface belongs to which stage.
 *
 * Nothing in this file references chat turns, model clients, or
 * SQLite; the memory core stays framework-free.
 */

/**
 * Schema version of the in-process memory domain types. Bump
 * alongside any breaking change to the record shapes so storage
 * adapters can migrate older rows on read.
 */
export const MEMORY_SCHEMA_VERSION = 1 as const;

/**
 * Identifies where a candidate came from, so any downstream record
 * (candidate row, decision row, active memory, debug event) can be
 * traced back to a chat turn.
 *
 * Lives here (not under `candidate/`) because every stage of the
 * pipeline carries it forward verbatim onto its own outputs.
 */
export interface MemoryCandidateSource {
    userId: string;
    characterId: string;
    conversationId: string;
    userMessageId: string;
    assistantMessageId: string;
    requestId: string;
    /**
     * Free-form purpose name, e.g. "chat.main". A string instead of a
     * union so the memory module does not need to track every new
     * model-call purpose added elsewhere.
     */
    modelCallPurpose: string;
}

/**
 * Wall-clock provider, abstracted so tests can pin time.
 */
export interface MemoryClock {
    nowIso(): string;
}

/**
 * Id generator port — abstracted so tests can produce reproducible
 * candidate / memory / decision ids without monkey-patching
 * `crypto.randomUUID`.
 */
export interface MemoryIdGenerator {
    randomId(): string;
}

/**
 * Minimal logger contract used by the memory pipeline.
 *
 * Compatible with `PersonaFlowLogger` but redefined here so the
 * memory module never imports chat-turn code. The pipeline-specific
 * `MemoryPipelineLogger` (see `./logging/MemoryPipelineLogger.ts`)
 * wraps this contract and is what stage code actually calls.
 */
export interface MemoryLogger {
    debug?(message: string, payload?: unknown): void;
    info(message: string, payload?: unknown): void;
    warn(message: string, payload?: unknown): void;
    error(message: string, payload?: unknown): void;
}
