import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { toJSONSchema } from "zod";
import type { ModelCall, ModelCallRunInput, ModelCallRunResult, ModelCallStreamRunInput } from "../../modelCall.js";
import type { PromptContext } from "../../../prompt/promptContext.js";
import type { RenderedMessage } from "../../../prompt/promptTypes.js";
import type { PromptLanguage } from "../../../stores/character/character.js";
import type { SubmitTurnEventsArgs } from "@ss-ai/contracts";
import { renderPromptTemplate } from "../../../prompt/renderPromptTemplate.js";
import { getTurnEventsReplyText, mergeConsecutiveReplyTextEvents } from "../../../chatTurn/events/turnEventText.js";
import { parseSubmitTurnEventsArgs } from "../../../chatTurn/events/submitTurnEventsParser.js";
import { SUBMIT_TURN_EVENTS_TOOL_NAME, submitTurnEventsTool } from "../../../llm/tools/submitTurnEventsTool.js";
import type { StructuredOutputSchema } from "../../../llm/modelClient.js";
import {
    createSubmitTurnEventsPreviewParser,
} from "../../../chatTurn/events/submitTurnEventsStreamPreview.js";
import { buildPromptViewModel } from "./promptViewModel.js";
import { PersonaModelRequest, PersonaModelResponse } from "../../modelRuntime.js";

const __dir = dirname(fileURLToPath(import.meta.url));
const DEFAULT_PROMPT_LANGUAGE: PromptLanguage = "zh-CN";
const SYSTEM_TEMPLATE_PATHS: Record<PromptLanguage, string> = {
    "zh-CN": resolve(__dir, "./templates/system.zh-CN.md.hbs"),
    "en-US": resolve(__dir, "./templates/system.en-US.md.hbs"),
    "ja-JP": resolve(__dir, "./templates/system.ja-JP.md.hbs"),
};

export type SingleCharacterChatResult = {
    displayText: string;
    events: SubmitTurnEventsArgs["events"];
};

function normalizeSingleCharacterReply(
    replyText: string,
    names: Array<string | null | undefined>,
): string {
    // Defensive cleanup for legacy/model-slip prefixes; replyText.text should normally contain only spoken text because characterId carries the speaker identity.
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
        // Track which `replyText` event the previous streamed text fragment
        // belonged to so we can inject a `\n` separator when the model moves
        // on to the next replyText event. This keeps the live SSE display
        // aligned with the merged canonical text returned by `parsedOutput`.
        let lastReplyTextEventIndex: number | undefined;
        const llmResponse = await input.runtime.chatStream({
            ...llmRequest,
            onTextDelta: (delta) => {
                if (!delta) return;
                // The model is constrained by `response_format: json_schema`,
                // so each text delta is a fragment of the final JSON object.
                // Feed it through the preview parser to extract incremental
                // reply text and completed turn events.
                for (const event of preview.push(delta)) {
                    if (event.type === "replyTextDelta") {
                        if (
                            lastReplyTextEventIndex !== undefined
                            && lastReplyTextEventIndex !== event.eventIndex
                        ) {
                            input.onDisplayTextDelta?.("\n");
                        }
                        lastReplyTextEventIndex = event.eventIndex;
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
    const systemPrompt = (await renderPromptTemplate(resolveSystemTemplatePath(input.promptContext), viewModel)).trim();

    const messages: RenderedMessage[] = [
        ...(systemPrompt ? [{ role: "system" as const, content: systemPrompt }] : []),
        ...buildConversationMessages(input.promptContext),
    ];

    return {
        userId: input.userId,
        characterId: input.characterId,
        messages,
        modelCallPurpose: singleCharacterChatCall.purpose,
        structuredOutputSchema: buildSubmitTurnEventsStructuredOutputSchema(),
    };
}

function resolveSystemTemplatePath(promptContext: PromptContext): string {
    const language = promptContext.character?.language;
    if (language && language in SYSTEM_TEMPLATE_PATHS) {
        return SYSTEM_TEMPLATE_PATHS[language as PromptLanguage];
    }
    return SYSTEM_TEMPLATE_PATHS[DEFAULT_PROMPT_LANGUAGE];
}

function buildSubmitTurnEventsStructuredOutputSchema(): StructuredOutputSchema {
    const jsonSchema = toJSONSchema(submitTurnEventsTool.argsSchema, { io: "input" }) as Record<string, unknown>;
    const { $schema: _schemaUri, ...schemaDefinition } = jsonSchema;
    return {
        type: "json_schema",
        jsonSchema: {
            name: SUBMIT_TURN_EVENTS_TOOL_NAME,
            description: submitTurnEventsTool.description,
            schemaDefinition,
            strict: false,
        },
    };
}

function parseSingleCharacterChatResponse(
    llmResponse: PersonaModelResponse,
    promptContext: PromptContext,
): SingleCharacterChatResult {
    if (llmResponse.structuredOutput === undefined) {
        throw new Error(
            `Model response did not include structured output for ${SUBMIT_TURN_EVENTS_TOOL_NAME}.`,
        );
    }

    const submitTurnEventsOutput = parseSubmitTurnEventsArgs(llmResponse.structuredOutput);
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
    // Streaming providers tend to emit one `replyText` per paragraph; collapse
    // any consecutive run with the same speaker into a single event so the
    // canonical persisted events and the derived displayText match the shape
    // of a non-streaming response.
    const mergedEvents = mergeConsecutiveReplyTextEvents(input.submitTurnEventsOutput.events);
    return {
        displayText: normalizeSingleCharacterReply(getTurnEventsReplyText(mergedEvents), [
            selfActor?.displayName,
            input.promptContext.character?.displayName,
            input.promptContext.character?.name,
        ]),
        events: mergedEvents,
    };
}
