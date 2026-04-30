import { ApiChat, ApiChatStream, type ChatRequest, type ChatStreamEvent } from "@ss-ai/contracts";
import { AgentService, createModelClientFromConfig } from "../../agent/index.js";
import type { HistoryMessage } from "../../agent/types.js";
import { registerApi } from "../registerApi.js";
import { toErrorResponse, type HttpApiContext } from "./apiContext.js";

function createChatAgentService(context: HttpApiContext): AgentService {
    const settings = context.userSettingsStore.read();
    const chatFnModel = settings.functionModels?.chat;
    if (!chatFnModel?.provider || !chatFnModel?.model) {
        throw new Error("Chat model is not configured. Please set it in Settings → Model Assignment.");
    }
    const { provider, model } = chatFnModel;
    const modelEntry = context.config.models[provider];
    if (!modelEntry) {
        throw new Error(`Configured provider "${provider}" is not available.`);
    }
    const apiKey = context.userSettingsStore.getApiKey(provider);
    if (!apiKey) {
        throw new Error(`API key is not set for provider: ${provider}`);
    }
    const agentConfig = {
        provider: modelEntry.provider,
        apiUrl: modelEntry.apiUrl,
        model,
        apiKey,
        timeoutMs: context.config.agent.timeoutMs,
        maxRetries: context.config.agent.maxRetries
    };
    return new AgentService(agentConfig, { modelClient: createModelClientFromConfig(agentConfig) });
}

async function handleChat(context: HttpApiContext, body: ChatRequest) {
    const prompt = body?.prompt;
    const sessionId = body?.sessionId ?? crypto.randomUUID();

    context.logger.debug("chat: request received", {
        hasSessionId: Boolean(body?.sessionId),
        promptLength: typeof prompt === "string" ? prompt.length : 0,
        prompt,
    });

    // 1. Append user message
    await context.messageStore.appendMessage({
        id: crypto.randomUUID(),
        conversationId: sessionId,
        role: "user",
        content: prompt,
        createdAt: new Date().toISOString(),
    });

    // 2. Get recent messages for conversation context
    const recentMessages = await context.messageStore.getRecentMessages({
        conversationId: sessionId,
        limit: 20,
    });

    // 3. Build history — all messages except the one just appended (last entry)
    const history: HistoryMessage[] = recentMessages
        .slice(0, -1)
        .map(m => ({ role: m.role as "user" | "assistant", content: m.content }));

    // 4. Call LLM
    const runtimeAgentService = createChatAgentService(context);
    const response = await runtimeAgentService.chat({ prompt, sessionId, history });

    context.logger.debug("chat: completed", {
        requestPromptLength: typeof prompt === "string" ? prompt.length : 0,
        model: response.model,
        requestId: response.requestId
    });

    // 5. Append assistant message
    await context.messageStore.appendMessage({
        id: crypto.randomUUID(),
        conversationId: sessionId,
        role: "assistant",
        content: response.output,
        createdAt: new Date().toISOString(),
    });

    return response;
}

export function registerChatRoute(context: HttpApiContext): void {
    registerApi(context.app, ApiChat, {
        handleRequest: (_, body) => handleChat(context, body),
        handleError: (error) => {
            const response = toErrorResponse(error);
            context.logger.error("chat: failed", { message: response.message });
            return { status: 400, body: response };
        }
    });

    // SSE streaming endpoint
    context.app.post(ApiChatStream.apiUrl, async (req, res) => {
        const prompt = typeof req.body?.prompt === "string" ? req.body.prompt : "";
        const sessionId: string = typeof req.body?.sessionId === "string" && req.body.sessionId
            ? req.body.sessionId
            : crypto.randomUUID();
        const requestId = `stream-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

        context.logger.debug("chat/stream: request received", { promptLength: prompt.length, prompt });

        let agentService: AgentService;
        try {
            agentService = createChatAgentService(context);
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : "Unknown error";
            context.logger.error("chat/stream: agent setup failed", { message });
            res.status(400).json({ message });
            return;
        }

        res.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"
        });

        // 1. Append user message
        await context.messageStore.appendMessage({
            id: crypto.randomUUID(),
            conversationId: sessionId,
            role: "user",
            content: prompt,
            createdAt: new Date().toISOString(),
        });

        // 2. Get recent messages, build history
        const recentMessages = await context.messageStore.getRecentMessages({
            conversationId: sessionId,
            limit: 20,
        });
        const history: HistoryMessage[] = recentMessages
            .slice(0, -1)
            .map(m => ({ role: m.role as "user" | "assistant", content: m.content }));

        // 3. Call LLM
        let fullResponse: string;
        try {
            const chatResponse = await agentService.chat({ prompt, sessionId, history });
            fullResponse = chatResponse.output;
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : "Unknown error";
            context.logger.error("chat/stream: generation failed", { message });
            const errEvent: ChatStreamEvent = { type: "done", requestId, model: "error" };
            res.write(`data: ${JSON.stringify(errEvent)}\n\n`);
            res.end();
            return;
        }

        // 4. Append assistant message
        await context.messageStore.appendMessage({
            id: crypto.randomUUID(),
            conversationId: sessionId,
            role: "assistant",
            content: fullResponse,
            createdAt: new Date().toISOString(),
        });

        const settings = context.userSettingsStore.read();
        const modelName = settings.functionModels?.chat?.model ?? "unknown";
        const tokens = fullResponse.split(/(?<=\s)|(?=\s)/);

        let i = 0;
        const timer = setInterval(() => {
            if (i < tokens.length) {
                const event: ChatStreamEvent = { type: "chunk", content: tokens[i] };
                res.write(`data: ${JSON.stringify(event)}\n\n`);
                i++;
            } else {
                const event: ChatStreamEvent = { type: "done", requestId, model: modelName };
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

