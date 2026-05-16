import { createStandardPromptRenderer } from "../base/createStandardPromptRenderer.js";
import { buildSystemMessages } from "./systemPromptBuilder.js";

export const liveChatPromptRenderer = createStandardPromptRenderer(buildSystemMessages);
