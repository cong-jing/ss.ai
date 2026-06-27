/**
 * Runtime toggles for the memory write subsystem. Loaded from the
 * server config so operators can disable parts of the pipeline
 * without rebuilding.
 *
 * - `enabled`: master switch. When false, the chat turn service
 *   completely skips the memory pipeline (no recorder, no commit).
 *   The Batch 1 candidate logger still emits its INFO summary line
 *   so observability stays the same as before Batch 2.
 * - `immediateCommitEnabled`: when false, the recorder still saves
 *   candidates (so they show up in the debug API and can be judged
 *   later), but the immediate embed-and-commit pipeline is skipped.
 *   Used to simulate "judge mode" where an external worker decides
 *   commit timing.
 */
export interface MemoryFeatureConfig {
    enabled: boolean;
    immediateCommitEnabled: boolean;
}

export const DEFAULT_MEMORY_FEATURE_CONFIG: MemoryFeatureConfig = {
    enabled: true,
    immediateCommitEnabled: true,
};
