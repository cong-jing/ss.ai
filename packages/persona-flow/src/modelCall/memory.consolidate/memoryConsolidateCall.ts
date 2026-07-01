import type { ModelCallPurpose } from "@ss-ai/contracts";
import type { ModelRuntime, PersonaModelRequest } from "../modelRuntime.js";
import type {
    MemoryConsolidationJudgeInput,
    MemoryConsolidationJudgeResult,
} from "../../memory/consolidation/consolidationTypes.js";
import { buildConsolidationMessages } from "./consolidationPromptBuilder.js";
import {
    buildConsolidationStructuredOutputSchema,
    consolidationOutputSchema,
} from "./consolidationOutputSchema.js";

/**
 * Purpose-specific model call for the consolidation judge. It does
 * NOT use the chat `ModelCall` interface: there is no `PromptContext`
 * or `interactionMode`. The input is staging evidence + retained
 * candidates + policy. The system layer (processor) owns persistence;
 * this call owns prompt assembly, structured output schema, and
 * parsing.
 */
export interface MemoryConsolidateCallInput {
    runtime: ModelRuntime;
    userId: string;
    characterId: string;
    judgeInput: MemoryConsolidationJudgeInput;
}

export const MEMORY_CONSOLIDATE_PURPOSE: ModelCallPurpose = "memory.consolidate";

export const memoryConsolidateCall = {
    purpose: MEMORY_CONSOLIDATE_PURPOSE,
    async run(input: MemoryConsolidateCallInput): Promise<MemoryConsolidationJudgeResult> {
        const request: PersonaModelRequest = {
            userId: input.userId,
            characterId: input.characterId,
            messages: buildConsolidationMessages(input.judgeInput),
            modelCallPurpose: MEMORY_CONSOLIDATE_PURPOSE,
            structuredOutputSchema: buildConsolidationStructuredOutputSchema(),
        };
        const response = await input.runtime.chat(request);
        const parsed = consolidationOutputSchema.parse(response.structuredOutput);
        return {
            action: parsed.action,
            ...(parsed.targetRetainedMemoryId ? { targetRetainedMemoryId: parsed.targetRetainedMemoryId } : {}),
            ...(parsed.text ? { text: parsed.text } : {}),
            ...(parsed.importance !== undefined ? { importance: parsed.importance } : {}),
            ...(parsed.relatedEntities ? { relatedEntities: parsed.relatedEntities } : {}),
            ...(parsed.tags ? { tags: parsed.tags } : {}),
            ...(parsed.archiveRetainedMemoryIds ? { archiveRetainedMemoryIds: parsed.archiveRetainedMemoryIds } : {}),
            reasoning: parsed.reasoning,
            ...(parsed.confidence !== undefined ? { confidence: parsed.confidence } : {}),
            raw: response.structuredOutput,
            model: response.model,
            requestId: response.requestId,
        };
    },
};
