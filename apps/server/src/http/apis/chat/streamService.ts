import type { ChatStreamEvent, LlmResponseMode } from "@ss-ai/contracts";
import type { InteractionMode } from "@ss-ai/contracts";
import type { Request, Response } from "express";
import { resolveRequestUserId, type HttpApiContext } from "../apiContext.js";
import {
    createChatTurnService,
    getStatusCode,
    HttpStatusError,
    requireNonEmptyString,
    requireUserMessageText,
    resolveLlmResponseMode,
    resolveInteractionMode,
} from "./chatUtil.js";

export async function handleStreamChatRequest(context: HttpApiContext, req: Request, res: Response): Promise<void> {
    const requestId = `stream-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    let userMessageText: string;
    let characterId: string;
    let conversationId: string;
    let senderActorId: string | undefined;
    let llmResponseMode: LlmResponseMode;
    let interactionMode: InteractionMode;
    try {
        userMessageText = requireUserMessageText(req.body?.userMessageText, "chat/stream");
        characterId = requireNonEmptyString(req.body?.characterId, "characterId", "chat/stream");
        conversationId = requireNonEmptyString(req.body?.conversationId, "conversationId", "chat/stream");
        llmResponseMode = resolveLlmResponseMode(req.body?.llmResponseMode, "chat/stream", "non-structured");
        interactionMode = resolveInteractionMode(req.body?.interactionMode, "chat/stream");
        senderActorId = typeof req.body?.senderActorId === "string"
            ? req.body.senderActorId
            : undefined;
        if (llmResponseMode !== "non-structured") {
            throw new HttpStatusError(400, "chat/stream only supports llmResponseMode=non-structured.");
        }
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Unknown error";
        context.logger.error("chat/stream: invalid request", { message });
        res.status(getStatusCode(err)).json({ message });
        return;
    }

    const userId = await resolveRequestUserId(req, context);
    context.logger.debug("chat/stream: request received", {
        userMessageLength: userMessageText.length,
        userId,
        characterId,
        conversationId,
    });

    const turnService = await createChatTurnService(context);

    res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
    });

    let streamResult;
    try {
        streamResult = await turnService.streamTurn({
            userId,
            characterId,
            conversationId,
            userMessageText,
            llmResponseMode,
            interactionMode,
            senderActorId,
            includeAssembledMessages: Boolean(req.body?.includeAssembledMessages),
            onAssembledMessages: (messages) => {
                const assembledEvent: ChatStreamEvent = { type: "assembledMessages", messages };
                res.write(`data: ${JSON.stringify(assembledEvent)}\n\n`);
            },
            onChunk: (chunk: string) => {
                const event: ChatStreamEvent = { type: "chunk", content: chunk };
                res.write(`data: ${JSON.stringify(event)}\n\n`);
            },
        });
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Unknown error";
        context.logger.error("chat/stream: generation failed", { message });
        const errEvent: ChatStreamEvent = { type: "done", requestId, model: "error" };
        res.write(`data: ${JSON.stringify(errEvent)}\n\n`);
        res.end();
        return;
    }

    const doneEvent: ChatStreamEvent = {
        type: "done",
        requestId: streamResult.requestId,
        model: streamResult.model,
        apiKeySource: streamResult.apiKeySource,
    };
    res.write(`data: ${JSON.stringify(doneEvent)}\n\n`);
    res.end();
}
