import type { ChatDryRunRequest } from "@ss-ai/contracts";
import { DEFAULT_USER_ID, type HttpApiContext } from "../apiContext.js";
import {
    createChatTurnService,
    requireNonEmptyString,
    requireUserMessageText,
    resolveLlmResponseMode,
} from "./shared.js";

export async function handleDryRunChatRequest(context: HttpApiContext, body: ChatDryRunRequest & { userId?: string }) {
    const userMessageText = requireUserMessageText(body?.userMessageText, "chat/dry-run");
    const characterId = requireNonEmptyString(body?.characterId, "characterId", "chat/dry-run");
    const conversationId = requireNonEmptyString(body?.conversationId, "conversationId", "chat/dry-run");
    const llmResponseMode = resolveLlmResponseMode(body?.llmResponseMode, "chat/dry-run", "structured");
    const userId: string = typeof body?.userId === "string"
        ? body.userId
        : DEFAULT_USER_ID;

    context.logger.debug("chat/dry-run: request received", {
        userMessageLength: userMessageText.length,
        userId,
        characterId,
        conversationId,
    });

    const turnService = createChatTurnService(context);
    return await turnService.dryRunTurn({
        userId,
        characterId,
        conversationId,
        userMessageText,
        llmResponseMode,
        senderActorId: body?.senderActorId,
    });
}
