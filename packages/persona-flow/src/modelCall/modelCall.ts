import type { InteractionMode, LlmResponseMode, ModelCallPurpose } from "@ss-ai/contracts";
import type { PromptContext } from "../prompt/promptContext.js";
import type { RenderedMessage } from "../prompt/promptTypes.js";
import type { ModelToolCall } from "../llm/modelClient.js";
import type { ModelRuntime, PersonaModelResponse } from "./modelRuntime.js";

export type ModelCallPreparedRequest = {
    messages: RenderedMessage[];
    llmResponseMode: LlmResponseMode;
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

export interface ModelCall<TParsedOutput = unknown> {
    purpose: ModelCallPurpose;
    prepare(input: {
        promptContext: PromptContext;
        llmResponseMode: LlmResponseMode;
        interactionMode?: InteractionMode;
    }): Promise<ModelCallPreparedRequest>;
    parse(input: {
        response: PersonaModelResponse;
        prepared: ModelCallPreparedRequest;
        promptContext: PromptContext;
    }): TParsedOutput;
    toTurnResult(input: {
        response: PersonaModelResponse;
        parsedOutput: TParsedOutput;
        prepared: ModelCallPreparedRequest;
        promptContext: PromptContext;
    }): ModelCallTurnResult;
}

export async function runModelCall<TParsedOutput>(input: {
    modelCall: ModelCall<TParsedOutput>;
    runtime: ModelRuntime;
    userId: string;
    characterId: string;
    promptContext: PromptContext;
    llmResponseMode: LlmResponseMode;
    interactionMode?: InteractionMode;
}): Promise<{
    prepared: ModelCallPreparedRequest;
    response: PersonaModelResponse;
    parsedOutput: TParsedOutput;
    turnResult: ModelCallTurnResult;
}> {
    const prepared = await input.modelCall.prepare({
        promptContext: input.promptContext,
        llmResponseMode: input.llmResponseMode,
        interactionMode: input.interactionMode,
    });

    const response = await input.runtime.chat({
        userId: input.userId,
        characterId: input.characterId,
        messages: prepared.messages,
        llmResponseMode: prepared.llmResponseMode,
        modelCallPurpose: input.modelCall.purpose,
    });

    const parsedOutput = input.modelCall.parse({
        response,
        prepared,
        promptContext: input.promptContext,
    });

    const turnResult = input.modelCall.toTurnResult({
        response,
        parsedOutput,
        prepared,
        promptContext: input.promptContext,
    });

    return {
        prepared,
        response,
        parsedOutput,
        turnResult,
    };
}
