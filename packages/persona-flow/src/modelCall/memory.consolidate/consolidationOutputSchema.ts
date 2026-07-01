import { z } from "zod";
import { toJSONSchema } from "zod";
import type { StructuredOutputSchema } from "../../llm/modelClient.js";
import { JUDGE_ACTIONS } from "../../memory/consolidation/consolidationTypes.js";

/**
 * Structured output schema for the `memory.consolidate` judge. Kept
 * inside the model-call folder (not contracts) because only the
 * judge call and its parser need it; the frontend never validates
 * judge output directly.
 */
export const consolidationOutputSchema = z.object({
    action: z.enum(JUDGE_ACTIONS),
    targetRetainedMemoryId: z.string().optional(),
    text: z.string().optional(),
    importance: z.number().optional(),
    relatedEntities: z.array(z.string()).optional(),
    tags: z.array(z.string()).optional(),
    archiveRetainedMemoryIds: z.array(z.string()).optional(),
    reasoning: z.string(),
    confidence: z.number().optional(),
});

export type ConsolidationOutput = z.infer<typeof consolidationOutputSchema>;

export const CONSOLIDATION_SCHEMA_NAME = "memory_consolidation_decision";

export function buildConsolidationStructuredOutputSchema(): StructuredOutputSchema {
    const jsonSchema = toJSONSchema(consolidationOutputSchema, { io: "input" }) as Record<string, unknown>;
    const { $schema: _schemaUri, ...schemaDefinition } = jsonSchema;
    return {
        type: "json_schema",
        jsonSchema: {
            name: CONSOLIDATION_SCHEMA_NAME,
            description: "Consolidation judge recommendation for a memory staging row.",
            schemaDefinition,
            strict: false,
        },
    };
}
