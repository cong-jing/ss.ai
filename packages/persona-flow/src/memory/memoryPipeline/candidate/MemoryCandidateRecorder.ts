import type {
    MemoryClock,
    MemoryIdGenerator,
    MemoryLogger,
    MemoryCandidateSource,
} from "../memoryPipelineTypes.js";
import type { MemoryCandidateStore } from "./candidatePorts.js";
import type { MemoryCandidateDraft, MemoryCandidateRecord } from "./candidateTypes.js";
import { normalizeMemoryText } from "./textNormalization.js";

/**
 * Result of one {@link MemoryCandidateRecorder.recordCandidates} call.
 *
 * `accepted` is the list of fully persisted candidate rows ready to
 * be handed to the processing stage. `rejectedCount` is the number
 * of drafts dropped during pre-persistence filtering (empty text
 * after trim, etc.) so callers can surface a metric without
 * re-walking the input. `storeError` is set when the underlying
 * store rejected the whole batch — the recorder treats this as a
 * fail-soft warning so chat turns never break because the memory
 * layer is down.
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
 * Persists raw model-emitted memory candidates into the candidate
 * store and prepares them for the processing stage.
 *
 * Design rules:
 *  - Fail-soft: a store outage degrades to "no candidates recorded",
 *    never to "chat turn failed". The chat turn service treats the
 *    memory subsystem as best-effort.
 *  - Pure-text filtering happens here (empty / whitespace-only),
 *    because the processor should not have to revisit malformed
 *    drafts. Value judgements (low-value, duplicates, similarity)
 *    belong in the processor so the recorder stays cheap and easy
 *    to reason about.
 *  - Normalization is the recorder's responsibility so the store
 *    can treat `normalizedText` as authoritative for exact-match
 *    lookups without having to re-implement the policy.
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
        // after trim. We do NOT drop based on `normalizeMemoryText`
        // returning empty here because that's a low-value signal the
        // processor owns; the recorder's job is only to reject
        // structurally meaningless inputs.
        const accepted: MemoryCandidateDraft[] = [];
        const normalizedTexts: string[] = [];
        let rejectedCount = 0;
        for (const draft of candidates) {
            const text = typeof draft?.text === "string" ? draft.text.trim() : "";
            if (text.length === 0) {
                rejectedCount += 1;
                continue;
            }
            accepted.push({ ...draft, text });
            normalizedTexts.push(normalizeMemoryText(text));
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
                normalizedTexts,
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
