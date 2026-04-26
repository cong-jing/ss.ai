import type { ConnectionInput } from "../types";

export interface AppState {
    connection: ConnectionInput;
    availableModels: string[];
}

export const appState: AppState = {
    connection: {
        provider: "mistral.ai",
        apiKey: ""
    },
    availableModels: []
};
