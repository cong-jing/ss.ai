import { ModelGenerationResult, ModelStreamCallbacks, ModelStreamResult, ModelStructuredResult } from "@ss-ai/persona-flow";


export interface ModelAdapter {
    generateNonStructured(input: {
        model: string;
        messages: unknown[];
        apiKey: string;
    }): Promise<ModelGenerationResult>;
    generateNonStructuredStream(input: {
        model: string;
        messages: unknown[];
        apiKey: string;
    }, callbacks?: ModelStreamCallbacks): Promise<ModelStreamResult>;
    generateStructured(input: {
        model: string;
        messages: unknown[];
        apiKey: string;
    }): Promise<ModelStructuredResult>;
    listModels(provider: string): Promise<string[]>;
}