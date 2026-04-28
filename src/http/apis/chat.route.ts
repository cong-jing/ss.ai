import { ApiChat, ApiChatStream, type ChatRequest, type ChatStreamEvent } from "../../../shared/contracts/httpApi.js";
import { AgentService, createModelClientFromConfig } from "../../agent/index.js";
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
    const sessionId = body?.sessionId;

    context.logger.debug("chat: request received", {
        hasSessionId: Boolean(sessionId),
        promptLength: typeof prompt === "string" ? prompt.length : 0,
        prompt,
    });

    const runtimeAgentService = createChatAgentService(context);
    const response = await runtimeAgentService.chat({ prompt, sessionId });

    context.logger.debug("chat: completed", {
        requestPromptLength: typeof prompt === "string" ? prompt.length : 0,
        model: response.model,
        requestId: response.requestId
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

        let fullResponse: string;
        try {
            const chatResponse = await agentService.chat({ prompt, sessionId: req.body?.sessionId });
            fullResponse = chatResponse.output;
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : "Unknown error";
            context.logger.error("chat/stream: generation failed", { message });
            const errEvent: ChatStreamEvent = { type: "done", requestId, model: "error" };
            res.write(`data: ${JSON.stringify(errEvent)}\n\n`);
            res.end();
            return;
        }

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

