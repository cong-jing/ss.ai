/**
 * Runtime settings for the memory subsystem.
 *
 * Externally the only two knobs the server exposes are:
 *  - `enabled` is the master switch.
 *  - `candidateProcessingMode`: `"inline"` runs the full record ->
 *    embed -> rank -> decide -> persist chain inside the chat turn;
 *    `"record_only"` stops after the recorder so a background
 *    worker / debug API / human judge can process candidates later.
 *
 * The remaining knobs (ranking thresholds, embedding signature
 * version, log verbosity) live here as in-code defaults rather than
 * in the server config:
 *  - They are tuning numbers we want to iterate on without bumping
 *    the config schema.
 *  - They are far more likely to migrate to user preferences /
 *    admin UI than to a static server JSON.
 *  - The embedding purpose used to resolve the model assignment is
 *    a fixed identifier (`"memory.embed"`) and never needs to be
 *    configurable per deployment.
 */
export interface MemorySettings {
    enabled: boolean;
    candidateProcessingMode: "inline" | "record_only";
    ranking: {
        listLimit: number;
        topK: number;
        needsJudgeThreshold: number;
        exactDuplicateThreshold: number;
    };
    embedding: {
        version: number;
    };
    logging: {
        detailLevel: "summary" | "debug";
        includeCandidateText: boolean;
    };
}

export const DEFAULT_MEMORY_SETTINGS: MemorySettings = {
    enabled: true,
    candidateProcessingMode: "inline",
    ranking: {
        listLimit: 500,
        topK: 10,
        needsJudgeThreshold: 0.80,
        exactDuplicateThreshold: 0.95,
    },
    embedding: {
        version: 1,
    },
    logging: {
        detailLevel: "debug",
        includeCandidateText: false,
    },
};
