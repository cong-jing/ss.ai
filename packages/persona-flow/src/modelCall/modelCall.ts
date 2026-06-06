import type { InteractionMode, ModelCallPurpose } from "@ss-ai/contracts";
import type { PromptContext } from "../prompt/promptContext.js";
import type { ModelRuntime, PersonaModelRequest, PersonaModelResponse } from "./modelRuntime.js";

export type ModelCallParsedToolCall<TParsedOutput = unknown> = {
    toolName: string;
    parsedOutput: TParsedOutput;
};

export type ModelCallRunInput = {
    runtime: ModelRuntime;
    userId: string;
    characterId: string;
    promptContext: PromptContext;
    interactionMode?: InteractionMode;
    dryRun?: boolean;
};

export type ModelCallRunResult<TParsedOutput = unknown> = {
    llmRequestSnapshot: PersonaModelRequest;
    llmResponse?: PersonaModelResponse;
    parsedOutput?: TParsedOutput;
    parsedToolCalls?: ModelCallParsedToolCall[];
};

export interface ModelCall<TParsedOutput = unknown> {
    purpose: ModelCallPurpose;
    run(input: ModelCallRunInput): Promise<ModelCallRunResult<TParsedOutput>>;
}
