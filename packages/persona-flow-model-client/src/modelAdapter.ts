import { ModelNonStructuredResult, ModelStreamCallbacks, ModelStreamResult, ModelStructuredResult } from "@ss-ai/persona-flow";


export interface ModelAdapter {
    generateNonStructured(input: {
        model: string;
        messages: unknown[];
        encryptedApiKey: string;
    }): Promise<ModelNonStructuredResult>;
    generateNonStructuredStream(input: {
        model: string;
        messages: unknown[];
        encryptedApiKey: string;
    }, callbacks?: ModelStreamCallbacks): Promise<ModelStreamResult>;
    generateStructured(input: {
        model: string;
        messages: unknown[];
        encryptedApiKey: string;
    }): Promise<ModelStructuredResult>;
    listModels(): Promise<string[]>;
}
