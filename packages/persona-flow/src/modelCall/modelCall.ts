import type { InteractionMode, ModelCallPurpose, TurnEvent } from "@ss-ai/contracts";
import type { PromptContext } from "../prompt/promptContext.js";
import type { RenderedMessage } from "../prompt/promptTypes.js";
import type { ModelToolCall, StructuredOutputSchema } from "../llm/modelClient.js";
import type { ModelRuntime, PersonaModelRequest, PersonaModelResponse } from "./modelRuntime.js";

export type ModelCallPreparedRequest = {
    messages: RenderedMessage[];
    structuredOutputSchema?: StructuredOutputSchema;
};

export type ModelCallOutcome =
    | {
        kind: "assistantReply";
        text: string;
        turnEvents?: TurnEvent[];
    }
    | {
        kind: "noReply";
        reason: string;
    }
    | {
        kind: "toolCalls";
        toolCalls: ModelToolCall[];
    };

export type ModelCallRunInput = {
    runtime: ModelRuntime;
    userId: string;
    characterId: string;
    promptContext: PromptContext;
    interactionMode?: InteractionMode;
    dryRun?: boolean;
};

export type ModelCallRunResult<TParsedModelOutput = unknown> = {
    llmRequestSnapshot: PersonaModelRequest;
    llmResponse?: PersonaModelResponse;
    parsedModelOutput?: TParsedModelOutput;
    outcome?: ModelCallOutcome;
};

export interface ModelCall<TParsedModelOutput = unknown> {
    purpose: ModelCallPurpose;
    run(input: ModelCallRunInput): Promise<ModelCallRunResult<TParsedModelOutput>>;
}
