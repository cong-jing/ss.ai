import { z } from "zod";
import type { StructuredOutputSchema } from "../../../llm/modelClient.js";

const singleCharacterChatOutputZodSchema = z.object({
    replyText: z.string().min(1),
}).strict();

export type SingleCharacterChatOutput = z.infer<typeof singleCharacterChatOutputZodSchema>;

export const singleCharacterChatStructuredOutputSchema: StructuredOutputSchema = {
    type: "json_schema",
    jsonSchema: {
        name: "single_character_chat_output",
        schemaDefinition: z.toJSONSchema(singleCharacterChatOutputZodSchema, {
            target: "jsonSchema7",
        }) as Record<string, unknown>,
        strict: true,
    },
};

export function parseSingleCharacterChatOutput(output: unknown): SingleCharacterChatOutput {
    return singleCharacterChatOutputZodSchema.parse(output);
}