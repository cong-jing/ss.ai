import type { z } from "zod";

export type ModelToolPurpose =
    | "final_output"
    | "context_query"
    | "state_query"
    | "side_effect";

export interface ModelFunctionToolChoice {
    type: "function";
    functionName: string;
}

export type ModelToolChoice =
    | "auto"
    | "required"
    | ModelFunctionToolChoice;

export interface ModelFunctionToolDefinition<TArgs = unknown> {
    kind: "function";
    name: string;
    description: string;
    argsSchema: z.ZodType<TArgs>;
    terminal?: boolean;
    purpose?: ModelToolPurpose;
}

export type ModelToolDefinition<TArgs = unknown> =
    ModelFunctionToolDefinition<TArgs>;

