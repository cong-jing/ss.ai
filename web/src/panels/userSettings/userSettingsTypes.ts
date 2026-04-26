export interface UserSettings {
    providers: string[];
    currentProvider: string | null;
    currentModel: string | null;
    availableModels: string[];
    apiKey: string;
    apiKeySet: boolean;
}

export interface SaveUserSettingsPayload {
    provider: string;
    model: string | null;
    apiKey: string | null;
}
