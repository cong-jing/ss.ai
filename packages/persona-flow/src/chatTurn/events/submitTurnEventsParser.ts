import {
    SubmitTurnEventsArgsSchema,
    type SubmitTurnEventsArgs,
} from "@ss-ai/contracts";
import type { ZodError } from "zod";

export type SafeParseSubmitTurnEventsArgsResult =
    | {
        success: true;
        data: SubmitTurnEventsArgs;
    }
    | {
        success: false;
        error: Error | ZodError;
    };

function normalizeToolArguments(argumentsValue: unknown): unknown {
    if (typeof argumentsValue !== "string") {
        return argumentsValue;
    }

    return JSON.parse(argumentsValue);
}

export function parseSubmitTurnEventsArgs(argumentsValue: unknown): SubmitTurnEventsArgs {
    return SubmitTurnEventsArgsSchema.parse(normalizeToolArguments(argumentsValue));
}

export function safeParseSubmitTurnEventsArgs(argumentsValue: unknown): SafeParseSubmitTurnEventsArgsResult {
    try {
        const data = parseSubmitTurnEventsArgs(argumentsValue);
        return { success: true, data };
    } catch (error: unknown) {
        return {
            success: false,
            error: error instanceof Error ? error : new Error("Unknown submit_turn_events parse error."),
        };
    }
}

