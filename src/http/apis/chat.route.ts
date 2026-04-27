import { ApiChat, ApiChatStream, type ChatStreamEvent } from "../../../shared/contracts/httpApi";
import { registerApi } from "../registerApi";
import { toErrorResponse, type HttpApiContext } from "./apiContext";

export function registerChatRoute(context: HttpApiContext): void {
    registerApi(context.app, ApiChat, async ({ body }) => {
        const prompt = body?.prompt;
        const sessionId = body?.sessionId;

        context.logger.debug("chat: request received", {
            hasSessionId: Boolean(sessionId),
            promptLength: typeof prompt === "string" ? prompt.length : 0,
            prompt,
        });

        const runtimeAgentService = context.createAgentServiceFromUserSettings();
        const response = await runtimeAgentService.chat({
            prompt,
            sessionId
        });

        context.logger.debug("chat: completed", {
            requestPromptLength: typeof prompt === "string" ? prompt.length : 0,
            model: response.model,
            requestId: response.requestId
        });

        return response;
    }, {
        onError: (error) => {
            const response = toErrorResponse(error);
            context.logger.error("chat: failed", {
                message: response.message
            });

            return {
                status: 400,
                body: response
            };
        }
    });

    // SSE streaming endpoint (test simulation)
    context.app.post(ApiChatStream.apiUrl, (req, res) => {
        const prompt = typeof req.body?.prompt === "string" ? req.body.prompt : "";
        const requestId = `stream-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

        context.logger.debug("chat/stream: request received", { promptLength: prompt.length, prompt });

        res.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"
        });

        const fakeReply = `[Stream test] Got your message: "${prompt.slice(0, 60)}${prompt.length > 60 ? "..." : ""}". This response is simulated word by word to demonstrate SSE streaming. Replace this with a real model stream call later.`;
        const tokens = fakeReply.split(/(?<=\s)|(?=\s)/);

        let i = 0;
        const timer = setInterval(() => {
            if (i < tokens.length) {
                const event: ChatStreamEvent = { type: "chunk", content: tokens[i] };
                res.write(`data: ${JSON.stringify(event)}\n\n`);
                context.logger.info("chat/stream: chunk sent", { i, token: tokens[i] });
                i++;
            } else {
                const event: ChatStreamEvent = { type: "done", requestId, model: "test-stream" };
                res.write(`data: ${JSON.stringify(event)}\n\n`);
                clearInterval(timer);
                res.end();
            }
        }, 40);

        res.on("close", () => {
            clearInterval(timer);
        });
    });
}

