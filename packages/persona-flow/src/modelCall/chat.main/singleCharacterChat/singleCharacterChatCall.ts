import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { toJSONSchema } from "zod";
import type { ModelCall, ModelCallRunInput, ModelCallRunResult, ModelCallStreamRunInput } from "../../modelCall.js";
import type { PromptContext } from "../../../prompt/promptContext.js";
import type { RenderedMessage } from "../../../prompt/promptTypes.js";
import type { PromptLanguage } from "../../../stores/character/character.js";
import type { MemoryWriteCandidate, SubmitTurnEventsArgs } from "@ss-ai/contracts";
import { MemoryWriteCandidateSchema } from "@ss-ai/contracts/memoryCandidates.schema";
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
    memoryWriteCandidates: MemoryWriteCandidate[];
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
    if (language && Object.hasOwn(SYSTEM_TEMPLATE_PATHS, language)) {
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
        // Memory candidates now live inside the structured output, so the
        // only legitimate cause for a missing structured payload is the
        // model producing zero content (e.g. unexpected tool call or empty
        // response). Surface any unexpected tool calls in the message so
        // it's debuggable from logs without diving into the provider response.
        const toolCallNames = llmResponse.toolCalls
            .map(call => call.functionName)
            .filter((name): name is string => Boolean(name));
        const detail = toolCallNames.length > 0
            ? ` Unexpected tool calls received: [${toolCallNames.join(", ")}]. This call does not register any tools; the model must always return ${SUBMIT_TURN_EVENTS_TOOL_NAME} structured output.`
            : " Model returned an empty content channel and no tool calls.";
        throw new Error(
            `Model response did not include structured output for ${SUBMIT_TURN_EVENTS_TOOL_NAME}.${detail}`,
        );
    }

    const { eventsOnly, rawCandidates } = splitStructuredOutput(llmResponse.structuredOutput);
    const submitTurnEventsOutput = parseSubmitTurnEventsArgs(eventsOnly);
    const memoryWriteCandidates = parseMemoryWriteCandidatesLeniently(rawCandidates);
    return {
        ...toSingleCharacterChatResult({
            submitTurnEventsOutput,
            promptContext,
        }),
        memoryWriteCandidates,
    };
}

/**
 * Memory candidates live inside the same structured-output JSON as `events`,
 * but they are a fail-soft side channel for batch 1: an invalid candidate
 * must never block the visible chat turn. We split candidates out before
 * strict events validation, then validate each candidate independently and
 * drop any that fail.
 */
function splitStructuredOutput(structuredOutput: unknown): {
    eventsOnly: unknown;
    rawCandidates: unknown;
} {
    if (typeof structuredOutput === "string") {
        // Provider adapters normally pre-parse JSON, but tolerate raw strings
        // here so we don't crash on a malformed adapter; let strict events
        // parsing raise the actual error.
        try {
            return splitStructuredOutput(JSON.parse(structuredOutput));
        } catch {
            return { eventsOnly: structuredOutput, rawCandidates: undefined };
        }
    }
    if (structuredOutput === null || typeof structuredOutput !== "object") {
        return { eventsOnly: structuredOutput, rawCandidates: undefined };
    }
    const { memoryWriteCandidates, ...rest } = structuredOutput as Record<string, unknown>;
    return { eventsOnly: rest, rawCandidates: memoryWriteCandidates };
}

function parseMemoryWriteCandidatesLeniently(rawCandidates: unknown): MemoryWriteCandidate[] {
    if (!Array.isArray(rawCandidates)) {
        return [];
    }
    const validated: MemoryWriteCandidate[] = [];
    for (const candidate of rawCandidates) {
        const parsed = MemoryWriteCandidateSchema.safeParse(candidate);
        if (parsed.success) {
            validated.push(parsed.data);
        }
        // Invalid candidates are silently dropped in batch 1; prompt logs
        // still contain the raw model output for diagnostics.
    }
    // The strict schema caps at 5; mirror that here so a misbehaving model
    // cannot flood the log via the lenient path.
    return validated.slice(0, 5);
}

function toSingleCharacterChatResult(input: {
    submitTurnEventsOutput: SubmitTurnEventsArgs;
    promptContext: PromptContext;
}): Omit<SingleCharacterChatResult, "memoryWriteCandidates"> {
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
