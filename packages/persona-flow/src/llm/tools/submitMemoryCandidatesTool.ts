import {
    SubmitMemoryCandidatesArgsSchema,
    type SubmitMemoryCandidatesArgs,
} from "@ss-ai/contracts/memoryCandidates.schema";
import type { ModelFunctionToolDefinition } from "./modelTool.js";

export const SUBMIT_MEMORY_CANDIDATES_TOOL_NAME = "submit_memory_candidates";

export const submitMemoryCandidatesTool: ModelFunctionToolDefinition<SubmitMemoryCandidatesArgs> = {
    kind: "function",
    name: SUBMIT_MEMORY_CANDIDATES_TOOL_NAME,
    description: "提交本回合可能值得长期保存的记忆候选。只有当信息未来明显有用、稳定、不是普通寒暄或临时情绪时才调用。没有候选时不要调用。",
    argsSchema: SubmitMemoryCandidatesArgsSchema,
    terminal: false,
    purpose: "side_effect",
};
