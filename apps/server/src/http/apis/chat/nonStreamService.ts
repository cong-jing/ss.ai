import type { ChatRequest } from "@ss-ai/contracts";
import { DEFAULT_USER_ID, type HttpApiContext } from "../apiContext.js";
import {
    createChatAgentService,
    normalizeAssistantOutput,
    prepareChatTurnContext,
    requireNonEmptyString,
    requirePrompt,
    resolveChatMode,
} from "./shared.js";

export async function handleNonStreamChatRequest(context: HttpApiContext, body: ChatRequest & { userId?: string }) {
    const prompt = requirePrompt(body?.prompt, "chat");
    const userId = typeof body?.userId === "string" ? body.userId : DEFAULT_USER_ID;
    const characterId = requireNonEmptyString(body?.characterId, "characterId", "chat");
    const conversationId = requireNonEmptyString(body?.conversationId, "conversationId", "chat");
    const mode = resolveChatMode(body?.mode, "chat", "structured");

    context.logger.debug("chat: request received", { promptLength: prompt.length, userId, characterId, conversationId });

    const prepared = await prepareChatTurnContext(context, {
        userId,
        characterId,
        conversationId,
        prompt,
        mode,
        speakerActorId: body?.speakerActorId,
        persistUserMessage: true,
    });

    const runtimeAgentService = await createChatAgentService(context, userId);
    const response = await runtimeAgentService.chat({
        messages: prepared.rendered.messages,
        mode,
    });
    const { output: rawOutput, requestId, model, structuredOutput } = response;

    if (structuredOutput?.control.summarizeSuggested) {
        context.logger.debug("chat: summarize suggested (TODO)", {
            requestId,
            urgency: structuredOutput.control.summarizeUrgency,
            reason: structuredOutput.control.summarizeReason,
        });
    }

    const selfActor = prepared.promptContext.actorMap.get(prepared.selfActorId);
    const normalizedAssistantOutput = normalizeAssistantOutput(rawOutput, [
        selfActor?.displayName,
        prepared.promptContext.character?.displayName,
        prepared.promptContext.character?.name,
    ]);

    const shouldSkip = mode === "structured" && (
        structuredOutput?.action === "skip"
        || normalizedAssistantOutput.trim().length === 0
    );

    if (shouldSkip) {
        return {
            requestId,
            model,
            output: "",
            userMessageId: prepared.userMessage.id,
            ...(structuredOutput ? { structuredOutput } : {}),
            ...(body.includePrompt ? { promptMessages: prepared.rendered.messages } : {}),
        };
    }

    const assistantMessageId = crypto.randomUUID();
    await context.stores.chat.appendMessage({
        id: assistantMessageId,
        conversationId,
        senderActorId: prepared.selfActorId,
        content: normalizedAssistantOutput,
        createdAt: new Date().toISOString(),
    });

    return {
        requestId,
        model,
        output: normalizedAssistantOutput,
        userMessageId: prepared.userMessage.id,
        assistantMessageId,
        ...(structuredOutput ? { structuredOutput } : {}),
        ...(body.includePrompt ? { promptMessages: prepared.rendered.messages } : {}),
    };
}
