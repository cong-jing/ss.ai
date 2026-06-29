import type {
    MemoryClock,
    MemoryIdGenerator,
    MemoryLogger,
    MemoryCandidateSource,
} from "../types.js";
import type { MemoryCandidateStore } from "./candidatePorts.js";
import type { MemoryCandidateDraft, MemoryCandidateRecord } from "./candidateTypes.js";

/**
 * Result of one {@link MemoryCandidateRecorder.recordCandidates} call.
 *
 * `accepted` is the list of fully persisted candidate rows that were
 * intaken. `rejectedCount` is the number of drafts dropped during
 * pre-persistence filtering (empty text after trim, etc.) so
 * callers can surface a metric without re-walking the input.
 * `storeError` is set when the underlying store rejected the whole
 * candidate list; the recorder treats this as a fail-soft warning
 * so chat turns never break because the memory layer is down.
 */
export interface RecordMemoryCandidatesResult {
    accepted: MemoryCandidateRecord[];
    rejectedCount: number;
    storeError?: Error;
}

export interface RecordMemoryCandidatesInput {
    source: MemoryCandidateSource;
    candidates: MemoryCandidateDraft[];
}

export interface MemoryCandidateRecorderDeps {
    candidateStore: MemoryCandidateStore;
    clock: MemoryClock;
    ids: MemoryIdGenerator;
    logger?: MemoryLogger;
}

/**
 * Intakes raw model-emitted memory candidates into the candidate
 * store.
 *
 * Batch 3.5 narrowed this stage to "validate + persist". Text
 * normalization, low-value filtering, embedding, and duplicate
 * aggregation moved downstream to the
 * {@link MemoryStagingProcessor}; the recorder no longer touches
 * any of those concerns.
 *
 * Design rules:
 *  - Fail-soft: a store outage degrades to "no candidates recorded",
 *    never to "chat turn failed". The chat turn service treats the
 *    memory subsystem as best-effort.
 *  - Only structural validation happens here (empty / whitespace-
 *    only text after trim). Value judgements belong in the
 *    processor so the recorder stays cheap and easy to reason
 *    about.
 */
export class MemoryCandidateRecorder {
    private readonly deps: MemoryCandidateRecorderDeps;

    constructor(deps: MemoryCandidateRecorderDeps) {
        this.deps = deps;
    }

    async recordCandidates(input: RecordMemoryCandidatesInput): Promise<RecordMemoryCandidatesResult> {
        const candidates = input.candidates ?? [];
        if (candidates.length === 0) {
            return { accepted: [], rejectedCount: 0 };
        }

        // Pre-filter: drop drafts whose `text` is empty / whitespace
        // after trim. We do NOT drop based on normalization here
        // because that is the staging processor's responsibility;
        // the recorder's only job is to reject structurally
        // meaningless inputs.
        const accepted: MemoryCandidateDraft[] = [];
        let rejectedCount = 0;
        for (const draft of candidates) {
            const text = typeof draft?.text === "string" ? draft.text.trim() : "";
            if (text.length === 0) {
                rejectedCount += 1;
                continue;
            }
            accepted.push({ ...draft, text });
        }

        if (accepted.length === 0) {
            this.deps.logger?.debug?.("memory.recorder.all_rejected", {
                rejectedCount,
                requestId: input.source.requestId,
            });
            return { accepted: [], rejectedCount };
        }

        try {
            const records = await this.deps.candidateStore.appendCandidates({
                source: input.source,
                candidates: accepted,
            });
            this.deps.logger?.debug?.("memory.recorder.persisted", {
                acceptedCount: records.length,
                rejectedCount,
                requestId: input.source.requestId,
            });
            return { accepted: records, rejectedCount };
        } catch (error) {
            // Fail-soft: the store failing should never bubble out of
            // the chat turn. Log loud enough for ops, return empty so
            // the processor simply finds nothing to do.
            const err = error instanceof Error ? error : new Error(String(error));
            this.deps.logger?.warn("memory.recorder.store_error", {
                message: err.message,
                requestId: input.source.requestId,
                attemptedCount: accepted.length,
            });
            return { accepted: [], rejectedCount, storeError: err };
        }
    }
}
