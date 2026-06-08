import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ModelCall, ModelCallRunInput, ModelCallRunResult, ModelCallStreamRunInput } from "../../modelCall.js";
import type { PromptContext } from "../../../prompt/promptContext.js";
import type { RenderedMessage } from "../../../prompt/promptTypes.js";
import type { SubmitTurnEventsArgs } from "@ss-ai/contracts";
import { renderPromptTemplate } from "../../../prompt/renderPromptTemplate.js";
import { getTurnEventsReplyText } from "../../../chatTurn/events/turnEventText.js";
import { parseSubmitTurnEventsArgs } from "../../../chatTurn/events/submitTurnEventsParser.js";
import { SUBMIT_TURN_EVENTS_TOOL_NAME, submitTurnEventsTool } from "../../../llm/tools/submitTurnEventsTool.js";
import type { ModelToolCall } from "../../../llm/modelClient.js";
import {
    createSubmitTurnEventsPreviewParser,
} from "../../../chatTurn/events/submitTurnEventsStreamPreview.js";
import { buildPromptViewModel } from "./promptViewModel.js";
import { PersonaModelRequest, PersonaModelResponse } from "../../modelRuntime.js";

const __dir = dirname(fileURLToPath(import.meta.url));
const SYSTEM_TEMPLATE_PATH = resolve(
    __dir,
    "./templates/system.zh-CN.md.hbs",
);

export type SingleCharacterChatResult = {
    displayText: string;
    events: SubmitTurnEventsArgs["events"];
};

function normalizeSingleCharacterReply(
    replyText: string,
    names: Array<string | null | undefined>,
): string {
    let normalized = replyText.trimStart();
    normalized = stripRepeatedPrefix(normalized, /^p\d+\[[^\]]+\]\s*[:：]\s*/u);

    const uniqueNames = Array.from(new Set(
        names
            .map(name => (typeof name === "string" ? name.trim() : ""))
            .filter(Boolean),
    ));

    for (const name of uniqueNames) {
        normalized = stripRepeatedPrefix(
            normalized,
            new RegExp(`^${escapeRegExp(name)}\\s*[:：]\\s*`, "u"),
        );
    }

    return normalized;
}

function buildConversationMessages(context: PromptContext): RenderedMessage[] {
    const historyMessages = context.recentMessages.map(message => {
        const actor = context.actorMap.get(message.senderActorId);
        const role = actor ? toLlmRole(actor.role) : "user";
        const content = role === "assistant"
            ? normalizeSingleCharacterReply(
                message.turnEvents ? getTurnEventsReplyText(message.turnEvents) : message.displayText,
                [
                    actor?.displayName,
                    context.character?.displayName,
                    context.character?.name,
                ],
            )
            : message.displayText;

        return { role, content };
    });

    return [
        ...historyMessages,
        {
            role: "user",
            content: context.currentUserMessage.displayText,
        },
    ];
}

function toLlmRole(actorRole: string): "system" | "user" | "assistant" {
    if (actorRole === "self") return "assistant";
    if (actorRole === "system") return "system";
    return "user";
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripRepeatedPrefix(text: string, regex: RegExp): string {
    let output = text;
    while (regex.test(output)) {
        output = output.replace(regex, "");
    }
    return output;
}

export const singleCharacterChatCall: ModelCall<SingleCharacterChatResult> = {
    purpose: "chat.main",
    async run(input): Promise<ModelCallRunResult<SingleCharacterChatResult>> {
        const llmRequest = await buildSingleCharacterChatRequest(input);

        if (input.dryRun) {
            return { llmRequestSnapshot: llmRequest };
        }

        const llmResponse = await input.runtime.chat(llmRequest);
        const parsedOutput = parseSingleCharacterChatResponse(llmResponse, input.promptContext);

        return {
            llmRequestSnapshot: llmRequest,
            llmResponse,
            // submit_turn_events is the terminal result for this call, so expose it
            // as the chat-specific parsedOutput instead of mirroring it as a parsedToolCall.
            parsedOutput,
        };
    },
    async runStream(input: ModelCallStreamRunInput): Promise<ModelCallRunResult<SingleCharacterChatResult>> {
        const llmRequest = await buildSingleCharacterChatRequest(input);

        if (input.dryRun) {
            return { llmRequestSnapshot: llmRequest };
        }

        const preview = createSubmitTurnEventsPreviewParser();
        const llmResponse = await input.runtime.chatStream({
            ...llmRequest,
            onToolCallDelta: (delta) => {
                // Only follow our terminal `submit_turn_events` tool. When the
                // model declares a different tool name, ignore its deltas for
                // preview purposes (final parse will still validate).
                if (delta.functionNameDelta && delta.functionNameDelta !== SUBMIT_TURN_EVENTS_TOOL_NAME) {
                    return;
                }
                if (!delta.argumentsDelta) return;

                for (const event of preview.push(delta.argumentsDelta)) {
                    if (event.type === "replyTextDelta") {
                        input.onDisplayTextDelta?.(event.text);
                    } else if (event.type === "turnEventPreview") {
                        input.onTurnEventPreview?.(event);
                    }
                }
            },
        });

        const parsedOutput = parseSingleCharacterChatResponse(llmResponse, input.promptContext);

        return {
            llmRequestSnapshot: llmRequest,
            llmResponse,
            parsedOutput,
        };
    },
};

async function buildSingleCharacterChatRequest(input: ModelCallRunInput): Promise<PersonaModelRequest> {
    const viewModel = buildPromptViewModel({
        character: input.promptContext.character,
        userProfile: input.promptContext.userProfile,
    });
    const systemPrompt = (await renderPromptTemplate(SYSTEM_TEMPLATE_PATH, viewModel)).trim();

    const messages: RenderedMessage[] = [
        ...(systemPrompt ? [{ role: "system" as const, content: systemPrompt }] : []),
        ...buildConversationMessages(input.promptContext),
    ];

    return {
        userId: input.userId,
        characterId: input.characterId,
        messages,
        modelCallPurpose: singleCharacterChatCall.purpose,
        tools: [submitTurnEventsTool],
        toolChoice: {
            type: "function",
            functionName: SUBMIT_TURN_EVENTS_TOOL_NAME,
        },
    };
}

function parseSingleCharacterChatResponse(
    llmResponse: PersonaModelResponse,
    promptContext: PromptContext,
): SingleCharacterChatResult {
    const toolCall = findSubmitTurnEventsToolCall(llmResponse.toolCalls);
    if (!toolCall) {
        throw new Error(`Model response did not call ${SUBMIT_TURN_EVENTS_TOOL_NAME}.`);
    }

    const submitTurnEventsOutput = parseSubmitTurnEventsArgs(toolCall.arguments);
    return toSingleCharacterChatResult({
        submitTurnEventsOutput,
        promptContext,
    });
}

function toSingleCharacterChatResult(input: {
    submitTurnEventsOutput: SubmitTurnEventsArgs;
    promptContext: PromptContext;
}): SingleCharacterChatResult {
    const selfActor = Array.from(input.promptContext.actorMap.values()).find(actor => actor.role === "self");
    return {
        displayText: normalizeSingleCharacterReply(getTurnEventsReplyText(input.submitTurnEventsOutput.events), [
            selfActor?.displayName,
            input.promptContext.character?.displayName,
            input.promptContext.character?.name,
        ]),
        events: input.submitTurnEventsOutput.events,
    };
}

function findSubmitTurnEventsToolCall(toolCalls: ModelToolCall[]): ModelToolCall | undefined {
    return toolCalls.find(toolCall => toolCall.functionName === SUBMIT_TURN_EVENTS_TOOL_NAME);
}
