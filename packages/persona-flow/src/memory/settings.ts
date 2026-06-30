/**
 * Runtime settings for the memory subsystem.
 *
 * Externally the server exposes:
 *  - `enabled` is the master switch.
 *  - `candidateProcessingMode`: `"inline"` runs the staging
 *    processor synchronously after intake; `"record_only"` stops
 *    after the recorder so a background worker / debug API / human
 *    judge can process candidates later.
 *
 * Batch 3.5 split the previous "recorder + processor + memory
 * store" pipeline into "candidate intake -> staging processor ->
 * staging store" and reserved `retained.*` for the Batch 4
 * consolidation pass. The settings shape mirrors that split:
 *  - `staging.*` tunes the candidate -> staging conversion
 *    (similarity sampling for verbose logs, duplicate aggregation,
 *    batch size for `processPendingCandidates`).
 *  - `retained.*` is a placeholder shell for Batch 4 retrieval and
 *    consolidation thresholds; keeping it here lets the contract
 *    stay stable when those pieces ship.
 *
 * The embedding signature version stays here as an in-code default
 * because it is a fixed identifier the server does not configure
 * per-deployment; the embedding purpose used to resolve the model
 * assignment is also a fixed identifier (`"memory.embed"`).
 */
export interface MemorySettings {
    enabled: boolean;
    candidateProcessingMode: "inline" | "record_only";
    embedding: {
        version: number;
    };
    staging: MemoryStagingSettings;
    retained: MemoryRetainedSettings;
}

export interface MemoryStagingSettings {
    /** Master switch for the candidate -> staging conversion. */
    enabled: boolean;
    /**
     * Default batch size for `processPendingCandidates({ limit })`
     * when the caller does not pass an explicit limit. Inline mode
     * normally processes the candidates from the current turn, so
     * this is mostly used by future async workers.
     */
    candidateBatchLimit: number;
    /**
     * How to detect "this candidate has already been staged before".
     */
    duplicate: {
        /**
         * When `true`, two candidates that produce the same
         * `normalizeMemoryText(...)` output collapse into one
         * staging row (incrementing `occurrenceCount`). Disable to
         * always create a new staging row per candidate (useful for
         * judging changes in tone / wording).
         */
        normalizedText: boolean;
    };
    /**
     * Lightweight similarity probe for verbose logging. The
     * processor samples the nearest existing staging rows so
     * operators can eyeball "near-duplicate" candidates while
     * tuning thresholds. Does NOT affect persistence in Batch 3.5;
     * Batch 4 will reuse these settings for actual similarity
     * judgements.
     */
    similaritySampling: {
        /** When `false` the processor does not run any similarity scan. */
        enabled: boolean;
        /**
         * Hard cap on staging rows scanned per candidate. Acts as a
         * defensive ceiling on the brute-force comparison cost.
         */
        listLimit: number;
        /**
         * Maximum number of nearest staging rows to surface in the
         * verbose retrieval-evidence log entry.
         */
        topK: number;
    };
}

export interface MemoryRetainedSettings {
    /**
     * Reserved for Batch 4 consolidation. When `false` (the Batch
     * 3.5 default) the consolidation pass is skipped entirely and
     * no retained rows are produced.
     */
    enabled: boolean;
    /**
     * How retained consolidation is triggered.
     *  - `"manual"`: only an explicit `processPendingMemoryStaging`
     *    call (debug route / script / future worker) runs the judge.
     *  - `"inline"`: dev-only; run after the chat turn. The
     *    processor stays decoupled from the chat turn either way.
     *  - `"worker"`: placeholder for a future async worker.
     */
    processingMode: "manual" | "inline" | "worker";
    /**
     * Default batch size for `processPendingMemoryStaging` when no
     * explicit limit is passed.
     */
    batchLimit: number;
    /**
     * Tuning constants for the retained retrieval that feeds the
     * judge's candidate context.
     */
    retrieval: {
        /** Top-K nearest retained memories to surface to the judge. */
        topK: number;
        /** Hard cap on retained rows scanned per staging row. */
        listLimit: number;
        /** Optional cosine floor; rows below it are dropped from judge context. */
        minSimilarityForJudgeContext?: number;
    };
    /**
     * Bounds for the judge call: enable switch and prompt-size caps.
     */
    judge: {
        enabled: boolean;
        maxSourceCandidates: number;
        maxRetainedForPrompt: number;
        maxTextChars: number;
    };
    /**
     * Allowed importance scale for retained memories (1..5 integer).
     * Judge output is clamped/validated against this.
     */
    importance: {
        min: number;
        max: number;
        default: number;
    };
}

export const DEFAULT_MEMORY_SETTINGS: MemorySettings = {
    enabled: true,
    candidateProcessingMode: "inline",
    embedding: {
        version: 1,
    },
    staging: {
        enabled: true,
        candidateBatchLimit: 50,
        duplicate: {
            normalizedText: true,
        },
        similaritySampling: {
            enabled: true,
            listLimit: 500,
            topK: 10,
        },
    },
    retained: {
        enabled: false,
        processingMode: "manual",
        batchLimit: 20,
        retrieval: {
            topK: 10,
            listLimit: 500,
        },
        judge: {
            enabled: true,
            maxSourceCandidates: 20,
            maxRetainedForPrompt: 10,
            maxTextChars: 600,
        },
        importance: {
            min: 1,
            max: 5,
            default: 3,
        },
    },
};
