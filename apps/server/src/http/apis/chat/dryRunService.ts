import type { ChatDryRunRequest } from "@ss-ai/contracts";
import type { Request } from "express";
import { resolveRequestUserId, type HttpApiContext } from "../apiContext.js";
import {
    createChatTurnService,
    requireNonEmptyString,
    requireUserMessageText,
    resolveInteractionMode,
} from "./chatUtil.js";

export async function handleDryRunChatRequest(context: HttpApiContext, req: Request, body: ChatDryRunRequest) {
    const userMessageText = requireUserMessageText(body?.userMessageText, "chat/dry-run");
    const characterId = requireNonEmptyString(body?.characterId, "characterId", "chat/dry-run");
    const conversationId = requireNonEmptyString(body?.conversationId, "conversationId", "chat/dry-run");
    const interactionMode = resolveInteractionMode(body?.interactionMode, "chat/dry-run");
    const userId = await resolveRequestUserId(req, context);

    context.logger.debug("chat/dry-run: request received", {
        userMessageLength: userMessageText.length,
        userId,
        characterId,
        conversationId,
    });

    const turnService = await createChatTurnService(context);
    return await turnService.dryRunTurn({
        userId,
        characterId,
        conversationId,
        userMessageText,
        interactionMode,
        senderActorId: body?.senderActorId,
    });
}
