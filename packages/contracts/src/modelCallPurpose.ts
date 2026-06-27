/** Model-call purpose identifiers shared between frontend and backend. */
export const MODEL_CALL_PURPOSES = [
    "chat.main",
    // "chat.semanticAnalysis",
    // "chat.toolContinuation",
    "memory.summarize",
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
