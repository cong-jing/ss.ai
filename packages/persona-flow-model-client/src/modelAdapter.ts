import { ModelGenerationResult, ModelStreamCallbacks, ModelStreamResult, ModelStructuredResult } from "@ss-ai/persona-flow";


export interface ModelAdapter {
    generateNonStructured(input: {
        provider: string;
        model: string;
        messages: unknown[];
        encryptedApiKey: string;
    }): Promise<ModelGenerationResult>;
    generateNonStructuredStream(input: {
        provider: string;
        model: string;
        messages: unknown[];
        encryptedApiKey: string;
    }, callbacks?: ModelStreamCallbacks): Promise<ModelStreamResult>;
    generateStructured(input: {
        provider: string;
        model: string;
        messages: unknown[];
        encryptedApiKey: string;
    }): Promise<ModelStructuredResult>;
    listModels(provider: string, encryptedApiKey?: string): Promise<string[]>;
}
