import type { ChatMode, ChatStreamEvent } from "@ss-ai/contracts";
import type { Request, Response } from "express";
import { DEFAULT_USER_ID, type HttpApiContext } from "../apiContext.js";
import {
    createChatAgentService,
    getStatusCode,
    HttpStatusError,
    normalizeAssistantOutput,
    prepareChatTurnContext,
    requireNonEmptyString,
    requirePrompt,
    resolveChatMode,
} from "./shared.js";

export async function handleStreamChatRequest(context: HttpApiContext, req: Request, res: Response): Promise<void> {
    const requestId = `stream-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    let prompt: string;
    let characterId: string;
    let conversationId: string;
    let speakerActorId: string | undefined;
    let mode: ChatMode;
    try {
        prompt = requirePrompt(req.body?.prompt, "chat/stream");
        characterId = requireNonEmptyString(req.body?.characterId, "characterId", "chat/stream");
        conversationId = requireNonEmptyString(req.body?.conversationId, "conversationId", "chat/stream");
        mode = resolveChatMode(req.body?.mode, "chat/stream", "non-structured");
        speakerActorId = typeof req.body?.speakerActorId === "string"
            ? req.body.speakerActorId
            : undefined;
        if (mode !== "non-structured") {
            throw new HttpStatusError(400, "chat/stream only supports mode=non-structured.");
        }
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Unknown error";
        context.logger.error("chat/stream: invalid request", { message });
        res.status(getStatusCode(err)).json({ message });
        return;
    }

    const userId: string = typeof req.body?.userId === "string" ? req.body.userId : DEFAULT_USER_ID;
    context.logger.debug("chat/stream: request received", {
        promptLength: prompt.length,
        userId,
        characterId,
        conversationId,
    });

    let agentService;
    try {
        agentService = await createChatAgentService(context, userId);
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Unknown error";
        context.logger.error("chat/stream: agent setup failed", { message });
        res.status(getStatusCode(err)).json({ message });
        return;
    }

    let prepared;
    try {
        prepared = await prepareChatTurnContext(context, {
            userId,
            characterId,
            conversationId,
            prompt,
            mode,
            speakerActorId,
            persistUserMessage: true,
        });
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Unknown error";
        context.logger.error("chat/stream: failed to prepare turn context", { message });
        res.status(getStatusCode(err)).json({ message });
        return;
    }

    res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
    });

    if (req.body?.includePrompt) {
        const promptEvent: ChatStreamEvent = { type: "prompt", messages: prepared.rendered.messages };
        res.write(`data: ${JSON.stringify(promptEvent)}\n\n`);
    }

    const selfActor = prepared.promptContext.actorMap.get(prepared.selfActorId);
    const normalizeNames = [
        selfActor?.displayName,
        prepared.promptContext.character?.displayName,
        prepared.promptContext.character?.name,
    ];

    let rawAccumulatedOutput = "";
    let normalizedSentLength = 0;
    let fullResponse: string;
    try {
        const chatResponse = await agentService.chatStream({
            messages: prepared.rendered.messages,
            mode,
            onTextDelta: (rawDelta: string) => {
                rawAccumulatedOutput += rawDelta;
                const normalizedSoFar = normalizeAssistantOutput(rawAccumulatedOutput, normalizeNames);
                if (normalizedSoFar.length > normalizedSentLength) {
                    const chunk = normalizedSoFar.slice(normalizedSentLength);
                    normalizedSentLength = normalizedSoFar.length;
                    const event: ChatStreamEvent = { type: "chunk", content: chunk };
                    res.write(`data: ${JSON.stringify(event)}\n\n`);
                }
            },
        });

        fullResponse = normalizeAssistantOutput(chatResponse.output, normalizeNames);

        if (fullResponse.length > normalizedSentLength) {
            const tail = fullResponse.slice(normalizedSentLength);
            const tailEvent: ChatStreamEvent = { type: "chunk", content: tail };
            res.write(`data: ${JSON.stringify(tailEvent)}\n\n`);
        }
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Unknown error";
        context.logger.error("chat/stream: generation failed", { message });
        const errEvent: ChatStreamEvent = { type: "done", requestId, model: "error" };
        res.write(`data: ${JSON.stringify(errEvent)}\n\n`);
        res.end();
        return;
    }

    await context.stores.chat.appendMessage({
        id: crypto.randomUUID(),
        conversationId,
        senderActorId: prepared.selfActorId,
        content: fullResponse,
        createdAt: new Date().toISOString(),
    });

    const prefs = await context.stores.userPreferences.getUserPreferences(userId);
    const modelName = prefs?.functionModels?.["chat"]?.model ?? "unknown";
    const doneEvent: ChatStreamEvent = { type: "done", requestId, model: modelName };
    res.write(`data: ${JSON.stringify(doneEvent)}\n\n`);
    res.end();
}
