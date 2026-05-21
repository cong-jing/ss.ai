import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ModelCall, ModelCallPreparedRequest, ModelCallTurnResult } from "../../modelCall.js";
import type { PromptContext } from "../../../prompt/promptContext.js";
import type { RenderedMessage } from "../../../prompt/promptTypes.js";
import { renderPromptTemplate } from "../../../prompt/renderPromptTemplate.js";
import { buildPromptViewModel } from "./promptViewModel.js";

const __dir = dirname(fileURLToPath(import.meta.url));
const SYSTEM_TEMPLATE_PATH = resolve(
    __dir,
    "../../../../data/modelCall/chat.main/singleCharacterChat/system.zh-CN.md.hbs",
);

export type SingleCharacterChatOutput = {
    replyText: string;
};

export type PreparedSingleCharacterChatCall = {
    messages: RenderedMessage[];
};

async function prepareSingleCharacterChatMainCall(
    context: PromptContext,
): Promise<PreparedSingleCharacterChatCall> {
    const systemPrompt = await renderSystemPrompt(context);
    return {
        messages: [
            ...(systemPrompt ? [{ role: "system" as const, content: systemPrompt }] : []),
            ...buildConversationMessages(context),
        ],
    };
}

function parseSingleCharacterChatOutput(output: unknown): SingleCharacterChatOutput {
    if (!output || typeof output !== "object") {
        throw new Error("singleCharacterChat output must be an object.");
    }

    const replyText = (output as { replyText?: unknown }).replyText;
    if (typeof replyText !== "string") {
        throw new Error("singleCharacterChat output.replyText must be a string.");
    }
    if (replyText.trim().length === 0) {
        throw new Error("singleCharacterChat output.replyText must not be empty.");
    }

    return { replyText };
}

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

async function renderSystemPrompt(context: PromptContext): Promise<string> {
    const viewModel = buildPromptViewModel({
        character: context.character,
        userProfile: context.userProfile,
    });
    return (await renderPromptTemplate(SYSTEM_TEMPLATE_PATH, viewModel)).trim();
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
    async prepare(input): Promise<ModelCallPreparedRequest> {
        const modelCall = await prepareSingleCharacterChatMainCall(input.promptContext);

        return {
            messages: modelCall.messages,
            llmResponseMode: "structured",
        };
    },
    parse(input): SingleCharacterChatOutput {
        return parseSingleCharacterChatOutput(input.response.structuredOutput);
    },
    toTurnResult(input): ModelCallTurnResult {
        const selfActor = Array.from(input.promptContext.actorMap.values()).find(actor => actor.role === "self");
        const replyText = normalizeSingleCharacterReply(input.parsedOutput.replyText, [
            selfActor?.displayName,
            input.promptContext.character?.displayName,
            input.promptContext.character?.name,
        ]);

        if (replyText.trim().length === 0) {
            return {
                kind: "noReply",
                reason: "empty-output",
                structuredOutput: input.parsedOutput,
            };
        }

        return {
            kind: "assistantReply",
            text: replyText,
            structuredOutput: input.parsedOutput,
        };
    },
};
