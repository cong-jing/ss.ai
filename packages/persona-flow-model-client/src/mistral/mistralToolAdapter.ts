import type { ModelGenerationInput, ModelToolChoice, ModelToolDefinition } from "@ss-ai/persona-flow";
import { toJSONSchema } from "zod";

export type MistralToolRequestFields = {
    tools?: MistralFunctionTool[];
    toolChoice?: MistralToolChoice;
};

type MistralFunctionTool = {
    type: "function";
    function: {
        name: string;
        description: string;
        parameters: Record<string, unknown>;
    };
};

type MistralToolChoice =
    | "auto"
    | "required"
    | {
        type: "function";
        function: {
            name: string;
        };
    };

export function toMistralToolRequest(input: ModelGenerationInput): MistralToolRequestFields {
    const tools = input.tools?.map(toMistralTool);
    if (!tools?.length) {
        return {};
    }

    return {
        tools,
        ...(input.toolChoice ? { toolChoice: toMistralToolChoice(input.toolChoice) } : {}),
    };
}

function toMistralTool(tool: ModelToolDefinition): MistralFunctionTool {
    return {
        type: "function",
        function: {
            name: tool.name,
            description: tool.description,
            parameters: toJsonSchemaParameters(tool.argsSchema),
        },
    };
}

function toMistralToolChoice(toolChoice: ModelToolChoice): MistralToolChoice {
    if (toolChoice === "auto" || toolChoice === "required") {
        return toolChoice;
    }

    return {
        type: "function",
        function: {
            name: toolChoice.functionName,
        },
    };
}

function toJsonSchemaParameters(schema: ModelToolDefinition["argsSchema"]): Record<string, unknown> {
    const jsonSchema = toJSONSchema(schema, { io: "input" }) as Record<string, unknown>;
    const { $schema: _schemaUri, ...parameters } = jsonSchema;
    return parameters;
}
