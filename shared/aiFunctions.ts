/**
 * AI function identifiers shared between frontend and backend.
 * Add new entries here when new features require model assignment.
 */
export const AI_FUNCTIONS = ["chat", "summarize"] as const;

export type AiFunction = typeof AI_FUNCTIONS[number];

export const AI_FUNCTION_LABELS: Record<AiFunction, string> = {
    chat: "Chat",
    summarize: "Summarize"
};
