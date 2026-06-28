/**
 * Runtime settings for the memory pipeline.
 *
 * Loaded from the server config (and optionally overridden by tests
 * or future per-user UI). These knobs cover *what* the pipeline does
 * (enabled? inline vs. record-only?), the ranking / decision shape,
 * the embedding "signature" version, and how much detail to log.
 *
 * Compared to the previous `MemoryFeatureConfig` this surface is
 * larger but each field is what a maintainer would actually want
 * to flip when investigating memory behaviour:
 *
 * - `enabled`: master switch. When false the chat turn service
 *   completely skips the pipeline; nothing is recorded or scored.
 *   The Batch 1 INFO log line for candidate emission is preserved
 *   elsewhere so dashboards keep working.
 * - `processingMode`: `inline` runs the full record → embed → rank
 *   → decide → persist chain inside the chat turn. `record_only`
 *   stops after the recorder, leaving pending candidates for a
 *   future background worker / debug API / human judge to consume.
 *   Replaces the old `immediateCommitEnabled` boolean.
 * - `ranking`: scan / similarity tuning knobs. `listLimit` is the
 *   maximum brute-force comparison fan-out per candidate;
 *   `topK` controls how many ranked entries are persisted in the
 *   decision summary; the thresholds drive the decision policy.
 * - `embedding`: which model-call purpose to resolve, plus a
 *   non-model "signature version" for preprocessing changes.
 *   Bumping `version` invalidates stored vectors without changing
 *   the underlying model identifier.
 * - `logging`: stage-level verbosity. `detailLevel: "debug"`
 *   enables per-stage debug events; `includeCandidateText` opts
 *   into emitting candidate text in those events (off by default
 *   because logs are not the right place for user content).
 */
export interface MemoryPipelineSettings {
    enabled: boolean;
    processingMode: "inline" | "record_only";
    ranking: {
        listLimit: number;
        topK: number;
        needsJudgeThreshold: number;
        exactDuplicateThreshold: number;
    };
    embedding: {
        modelCallPurpose: "memory.embed";
        version: number;
    };
    logging: {
        detailLevel: "summary" | "debug";
        includeCandidateText: boolean;
    };
}

export const DEFAULT_MEMORY_PIPELINE_SETTINGS: MemoryPipelineSettings = {
    enabled: true,
    processingMode: "inline",
    ranking: {
        listLimit: 500,
        topK: 10,
        needsJudgeThreshold: 0.80,
        exactDuplicateThreshold: 0.95,
    },
    embedding: {
        modelCallPurpose: "memory.embed",
        version: 1,
    },
    logging: {
        detailLevel: "debug",
        includeCandidateText: false,
    },
};
