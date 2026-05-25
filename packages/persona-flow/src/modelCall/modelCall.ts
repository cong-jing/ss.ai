import type { InteractionMode, LlmResponseMode, ModelCallPurpose } from "@ss-ai/contracts";
import type { PromptContext } from "../prompt/promptContext.js";
import type { RenderedMessage } from "../prompt/promptTypes.js";
import type { ModelToolCall, StructuredOutputSchema } from "../llm/modelClient.js";
import type { ModelRuntime, PersonaModelResponse } from "./modelRuntime.js";

export type ModelCallPreparedRequest = {
    messages: RenderedMessage[];
    llmResponseMode: LlmResponseMode;
    structuredOutputSchema?: StructuredOutputSchema;
};

export type ModelCallTurnResult =
    | {
        kind: "assistantReply";
        text: string;
        structuredOutput?: unknown;
    }
    | {
        kind: "noReply";
        reason: string;
        structuredOutput?: unknown;
    }
    | {
        kind: "toolCalls";
        toolCalls: ModelToolCall[];
        structuredOutput?: unknown;
    };

export type ModelCallRunInput = {
    runtime: ModelRuntime;
    userId: string;
    characterId: string;
    promptContext: PromptContext;
    llmResponseMode: LlmResponseMode;
    interactionMode?: InteractionMode;
    dryRun?: boolean;
};

export type ModelCallRunResult<TParsedOutput = unknown> = {
    prepared: ModelCallPreparedRequest;
    response?: PersonaModelResponse;
    parsedOutput?: TParsedOutput;
    turnResult?: ModelCallTurnResult;
};

export interface ModelCall<TParsedOutput = unknown> {
    purpose: ModelCallPurpose;
    run(input: ModelCallRunInput): Promise<ModelCallRunResult<TParsedOutput>>;
}
