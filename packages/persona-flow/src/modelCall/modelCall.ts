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
    // The semantic result promised by this model call to its caller. Chat-turn
    // orchestration reads this instead of inspecting provider tool calls, so the
    // service does not need to know whether a call used tools or structured output.
    parsedOutput?: TParsedOutput;
    // Parsed intermediate tool calls can be recorded here when they are useful to
    // the caller. Do not duplicate the final terminal tool result here when it has
    // already been folded into parsedOutput.
    parsedToolCalls?: ModelCallParsedToolCall[];
};

export interface ModelCall<TParsedOutput = unknown> {
    purpose: ModelCallPurpose;
    run(input: ModelCallRunInput): Promise<ModelCallRunResult<TParsedOutput>>;
}
