import type { ChatRequest } from "@ss-ai/contracts";
import { DEFAULT_USER_ID, type HttpApiContext } from "../apiContext.js";
import {
    createChatTurnService,
    requireNonEmptyString,
    requireUserMessageText,
    resolveLlmResponseMode,
    resolveInteractionMode,
} from "./chatUtil.js";

export async function handleNonStreamChatRequest(context: HttpApiContext, body: ChatRequest & { userId?: string }) {
    const userMessageText = requireUserMessageText(body?.userMessageText, "chat");
    const userId = typeof body?.userId === "string" ? body.userId : DEFAULT_USER_ID;
    const characterId = requireNonEmptyString(body?.characterId, "characterId", "chat");
    const conversationId = requireNonEmptyString(body?.conversationId, "conversationId", "chat");
    const llmResponseMode = resolveLlmResponseMode(body?.llmResponseMode, "chat", "structured");
    const interactionMode = resolveInteractionMode(body?.interactionMode, "chat");

    context.logger.debug("chat: request received", { userMessageLength: userMessageText.length, userId, characterId, conversationId });

    const turnService = await createChatTurnService(context);
    const response = await turnService.chatTurn({
        userId,
        characterId,
        conversationId,
        userMessageText,
        llmResponseMode,
        interactionMode,
        senderActorId: body?.senderActorId,
        includeAssembledMessages: body.includeAssembledMessages,
    });

    // const { requestId, model, structuredOutput } = response;

    // if (structuredOutput?.control.summarizeSuggested) {
    //     context.logger.debug("chat: summarize suggested (TODO)", {
    //         requestId,
    //         urgency: structuredOutput.control.summarizeUrgency,
    //         reason: structuredOutput.control.summarizeReason,
    //     });
    // }
    return response;
}
