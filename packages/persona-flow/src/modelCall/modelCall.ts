import type { InteractionMode, ModelCallPurpose } from "@ss-ai/contracts";
import type { PromptContext } from "../prompt/promptContext.js";
import type { ModelRuntime, PersonaModelRequest, PersonaModelResponse } from "./modelRuntime.js";
import type { SubmitTurnEventsTurnEventPreview } from "../chatTurn/events/submitTurnEventsStreamPreview.js";

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

/**
 * Optional callbacks the chat-turn service can pass to streaming model calls.
 *
 * Each callback is provider-neutral and application-level: the model call is
 * responsible for translating raw provider deltas (or tool-call argument
 * fragments) into these semantic previews before invoking the callbacks.
 */
export type ModelCallStreamRunInput = ModelCallRunInput & {
    onDisplayTextDelta?: (delta: string) => void;
    onTurnEventPreview?: (preview: SubmitTurnEventsTurnEventPreview) => void;
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
    /**
     * Optional streaming entry point. When implemented, the chat-turn service
     * will prefer this path and forward stream previews to its own callbacks.
     * Falls back to {@link run} when undefined.
     */
    runStream?(input: ModelCallStreamRunInput): Promise<ModelCallRunResult<TParsedOutput>>;
}
