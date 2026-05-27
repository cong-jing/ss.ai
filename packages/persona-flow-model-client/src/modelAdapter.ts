import type {
    ModelGenerationInput,
    ModelGenerationResult,
    ModelStreamCallbacks,
    ModelStreamResult,
} from "@ss-ai/persona-flow";


export interface ModelAdapter {
    generate(input: ModelGenerationInput): Promise<ModelGenerationResult>;
    generateStream(input: ModelGenerationInput, callbacks?: ModelStreamCallbacks): Promise<ModelStreamResult>;
    listModels(): Promise<string[]>;
}
