import type { ChatRequest } from "@ss-ai/contracts";
import type { Request } from "express";
import { resolveRequestUserId, type HttpApiContext } from "../apiContext.js";
import {
    createChatTurnService,
    requireNonEmptyString,
    requireUserMessageText,
    resolveLlmResponseMode,
    resolveInteractionMode,
} from "./chatUtil.js";

export async function handleNonStreamChatRequest(context: HttpApiContext, req: Request, body: ChatRequest) {
    const userMessageText = requireUserMessageText(body?.userMessageText, "chat");
    const userId = await resolveRequestUserId(req, context);
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

    return response;
}
