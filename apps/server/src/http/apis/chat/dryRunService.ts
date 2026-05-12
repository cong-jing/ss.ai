import type { ChatDryRunRequest } from "@ss-ai/contracts";
import { DEFAULT_USER_ID, type HttpApiContext } from "../apiContext.js";
import {
    prepareChatTurnContext,
    requireNonEmptyString,
    requirePrompt,
    resolveChatMode,
} from "./shared.js";

export async function handleDryRunChatRequest(context: HttpApiContext, body: ChatDryRunRequest & { userId?: string }) {
    const prompt = requirePrompt(body?.prompt, "chat/dry-run");
    const characterId = requireNonEmptyString(body?.characterId, "characterId", "chat/dry-run");
    const conversationId = requireNonEmptyString(body?.conversationId, "conversationId", "chat/dry-run");
    const mode = resolveChatMode(body?.mode, "chat/dry-run", "structured");
    const userId: string = typeof body?.userId === "string"
        ? body.userId
        : DEFAULT_USER_ID;

    context.logger.debug("chat/dry-run: request received", {
        promptLength: prompt.length,
        userId,
        characterId,
        conversationId,
    });

    const prepared = await prepareChatTurnContext(context, {
        userId,
        characterId,
        conversationId,
        prompt,
        mode,
        speakerActorId: body?.speakerActorId,
        persistUserMessage: false,
    });
    return { messages: prepared.rendered.messages };
}
