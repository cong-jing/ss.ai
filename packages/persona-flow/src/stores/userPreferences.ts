export type ModelSelection = {
    provider: string;
    model: string;
};

export type UserPreferences = {
    userId: string;
    currentCharacterId?: string | null;
    /** Map from function name (e.g. "chat", "summarize") to provider+model. */
    functionModels: Record<string, ModelSelection>;
    createdAt: string;
    updatedAt: string;
};
