import type { StructuredOutputSchema } from "../../../llm/modelClient.js";

export type SingleCharacterChatOutput = {
    replyText: string;
};

export const singleCharacterChatStructuredOutputSchema: StructuredOutputSchema = {
    type: "json_schema",
    jsonSchema: {
        name: "single_character_chat_output",
        schemaDefinition: {
            type: "object",
            properties: {
                replyText: {
                    type: "string",
                    minLength: 1,
                },
            },
            required: ["replyText"],
            additionalProperties: false,
        },
        strict: true,
    },
};

export function parseSingleCharacterChatOutput(output: unknown): SingleCharacterChatOutput {
    if (!output || typeof output !== "object") {
        throw new Error("singleCharacterChat output must be an object.");
    }

    const replyText = (output as { replyText?: unknown }).replyText;
    if (typeof replyText !== "string") {
        throw new Error("singleCharacterChat output.replyText must be a string.");
    }
    if (replyText.trim().length === 0) {
        throw new Error("singleCharacterChat output.replyText must not be empty.");
    }

    return { replyText };
}