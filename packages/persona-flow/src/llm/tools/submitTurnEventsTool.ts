import { SubmitTurnEventsArgsSchema, type SubmitTurnEventsArgs } from "@ss-ai/contracts";
import type { ModelFunctionToolDefinition } from "./modelTool.js";

export const SUBMIT_TURN_EVENTS_TOOL_NAME = "submit_turn_events";

export const submitTurnEventsTool: ModelFunctionToolDefinition<SubmitTurnEventsArgs> = {
    kind: "function",
    name: SUBMIT_TURN_EVENTS_TOOL_NAME,
    description: "提交本回合最终的有序事件列表。角色台词、表情变化、场景氛围变化、状态更新都必须通过这个工具提交。调用此工具后，本回合结束。",
    argsSchema: SubmitTurnEventsArgsSchema,
    terminal: true,
    purpose: "final_output",
};

