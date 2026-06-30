/** Model-call purpose identifiers shared between frontend and backend. */
export const MODEL_CALL_PURPOSES = [
    "chat.main",
    // "chat.semanticAnalysis",
    // "chat.toolContinuation",
    "memory.summarize",
    "memory.consolidate",
    "memory.embed",
    // "memory.extract",
    // "vision.ocr"
] as const;

export type ModelCallPurpose = typeof MODEL_CALL_PURPOSES[number];

export interface ModelAssignment {
    provider: string;
    model: string;
}

export type ModelAssignmentMap = Partial<
    Record<ModelCallPurpose, ModelAssignment>
>;

/**
 * Coarse capability category a provider model belongs to.
 *
 * Chat-completion and embedding models are distinct families on every
 * provider we support today (Mistral, OpenAI, Anthropic, etc.) and the
 * configured `availableModels` lists are split along this axis so a chat
 * purpose can never offer an embedding model and vice versa.
 */
export type ModelCapabilityCategory = "chat" | "embed";

/**
 * Maps each model-call purpose to the capability category its assigned
 * model must belong to. Used by:
 *  - server config cross-validator (rejects assignments whose model is not
 *    in the matching category list).
 *  - server preference route (filters dropdown options per purpose).
 *  - web UI (decides which slice of `availableModels` to show).
 */
export const MODEL_CALL_PURPOSE_CATEGORIES: Readonly<Record<ModelCallPurpose, ModelCapabilityCategory>> = {
    "chat.main": "chat",
    "memory.summarize": "chat",
    "memory.consolidate": "chat",
    "memory.embed": "embed",
};
