import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ModelCall, ModelCallOutcome, ModelCallPreparedRequest, ModelCallRunResult } from "../../modelCall.js";
import type { PromptContext } from "../../../prompt/promptContext.js";
import type { RenderedMessage } from "../../../prompt/promptTypes.js";
import { renderPromptTemplate } from "../../../prompt/renderPromptTemplate.js";
import { buildPromptViewModel } from "./promptViewModel.js";
import {
    parseSingleCharacterChatOutput,
    singleCharacterChatStructuredOutputSchema,
    type SingleCharacterChatOutput,
} from "./singleCharacterChatOutput.js";
import { PersonaModelRequest } from "../../modelRuntime.js";

export type { SingleCharacterChatOutput } from "./singleCharacterChatOutput.js";

const __dir = dirname(fileURLToPath(import.meta.url));
const SYSTEM_TEMPLATE_PATH = resolve(
    __dir,
    "../../../../data/modelCall/chat.main/singleCharacterChat/system.zh-CN.md.hbs",
);

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
            ? normalizeSingleCharacterReply(message.content, [
                actor?.displayName,
                context.character?.displayName,
                context.character?.name,
            ])
            : message.content;

        return { role, content };
    });

    return [
        ...historyMessages,
        {
            role: "user",
            content: context.currentUserMessage.content,
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

export const singleCharacterChatCall: ModelCall<SingleCharacterChatOutput> = {
    purpose: "chat.main",
    async run(input): Promise<ModelCallRunResult<SingleCharacterChatOutput>> {
        const viewModel = buildPromptViewModel({
            character: input.promptContext.character,
            userProfile: input.promptContext.userProfile,
        });
        const systemPrompt = (await renderPromptTemplate(SYSTEM_TEMPLATE_PATH, viewModel)).trim();

        const messages: RenderedMessage[] = [
            ...(systemPrompt ? [{ role: "system" as const, content: systemPrompt }] : []),
            ...buildConversationMessages(input.promptContext),
        ];

        const llmRequest: PersonaModelRequest = {
            userId: input.userId,
            characterId: input.characterId,
            messages,
            llmResponseMode: "structured",
            modelCallPurpose: this.purpose,
            structuredOutputSchema: singleCharacterChatStructuredOutputSchema,
        };

        if (input.dryRun) {
            return { llmRequestSnapshot: llmRequest };
        }

        const llmResponse = await input.runtime.chat(llmRequest);

        const parsedModelOutput = parseSingleCharacterChatOutput(llmResponse.structuredOutput);
        const outcome = toSingleCharacterChatOutcome({
            parsedModelOutput,
            promptContext: input.promptContext,
        });

        return {
            llmRequestSnapshot: llmRequest,
            llmResponse,
            parsedModelOutput,
            outcome,
        };
    },
};

function toSingleCharacterChatOutcome(input: {
    parsedModelOutput: SingleCharacterChatOutput;
    promptContext: PromptContext;
}): ModelCallOutcome {
    const selfActor = Array.from(input.promptContext.actorMap.values()).find(actor => actor.role === "self");
    const replyText = normalizeSingleCharacterReply(input.parsedModelOutput.replyText, [
        selfActor?.displayName,
        input.promptContext.character?.displayName,
        input.promptContext.character?.name,
    ]);

    if (replyText.trim().length === 0) {
        return {
            kind: "noReply",
            reason: "empty-output",
        };
    }

    return {
        kind: "assistantReply",
        text: replyText,
    };
}
