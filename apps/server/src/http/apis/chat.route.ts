import { ApiChat, ApiChatDryRun, ApiChatStream, ApiGetMessages, type ChatRequest, type ChatStreamEvent } from "@ss-ai/contracts";
import { PromptContextBuilder, promptRenderer } from "@ss-ai/persona-flow";
import { AgentService, createModelClientFromConfig } from "../../agent/index.js";
import { PromptLogger } from "../../util/promptLog.js";
import { registerApi } from "../registerApi.js";
import { toErrorResponse, DEFAULT_USER_ID, type HttpApiContext } from "./apiContext.js";

async function createChatAgentService(context: HttpApiContext): Promise<AgentService> {
    const prefs = await context.stores.userPreferences.getUserPreferences(DEFAULT_USER_ID);
    const chatFnModel = prefs?.functionModels?.["chat"];
    if (!chatFnModel?.provider || !chatFnModel?.model) {
        throw new Error("Chat model is not configured. Please set it in Settings → Model Assignment.");
    }
    const { provider, model } = chatFnModel;
    const modelEntry = context.config.models[provider];
    if (!modelEntry) {
        throw new Error(`Configured provider "${provider}" is not available.`);
    }
    const credential = await context.stores.providerCredential.getCredential({ userId: DEFAULT_USER_ID, provider });
    if (!credential) {
        throw new Error(`API key is not set for provider: ${provider}`);
    }
    const agentConfig = {
        provider: modelEntry.provider,
        apiUrl: modelEntry.apiUrl,
        model,
        apiKey: credential.apiKeyEncrypted,
        timeoutMs: context.config.agent.timeoutMs,
        maxRetries: context.config.agent.maxRetries,
    };
    return new AgentService(agentConfig, {
        modelClient: createModelClientFromConfig(agentConfig),
        promptLogger: new PromptLogger(context.config.promptLog),
    });
}

function requirePrompt(prompt: unknown, endpoint: string): string {
    if (typeof prompt !== "string" || prompt.trim().length === 0) {
        throw new Error(`${endpoint}: prompt is required.`);
    }

    return prompt;
}

/**
 * Resolve the active conversationId for the given character.
 * Stored in user_character_states (userId + characterId).
 * Auto-creates a new conversationId if no state exists yet (migration path).
 * Throws if no character is selected.
 */
async function resolveConversationId(context: HttpApiContext): Promise<{ characterId: string; conversationId: string }> {
    const prefs = await context.stores.userPreferences.getUserPreferences(DEFAULT_USER_ID);
    const characterId = prefs?.currentCharacterId;
    if (!characterId) {
        throw new Error("No active character selected. Please select a character before chatting.");
    }

    const existing = await context.stores.chat.getCharacterState({ userId: DEFAULT_USER_ID, characterId });
    if (existing) {
        return { characterId, conversationId: existing.currentConversationId };
    }

    // Auto-create state (migration: character exists but has no state record)
    const conversationId = crypto.randomUUID();
    const now = new Date().toISOString();
    await context.stores.conversation.createConversation({
        id: conversationId,
        userId: DEFAULT_USER_ID,
        characterId,
        title: null,
        createdAt: now,
        updatedAt: now,
    });
    await context.stores.chat.upsertCharacterState({
        userId: DEFAULT_USER_ID,
        characterId,
        currentConversationId: conversationId,
        createdAt: now,
        updatedAt: now,
    });
    context.logger.debug("chat: created new conversationId for character", { characterId, conversationId });
    return { characterId, conversationId };
}

async function handleChat(context: HttpApiContext, body: ChatRequest) {
    const prompt = requirePrompt(body?.prompt, "chat");

    context.logger.debug("chat: request received", {
        promptLength: typeof prompt === "string" ? prompt.length : 0,
        prompt,
    });

    const conversationId = await resolveConversationId(context);

    // 1. Append user message
    const userMessage = {
        id: crypto.randomUUID(),
        userId: DEFAULT_USER_ID,
        conversationId: conversationId.conversationId,
        role: "user" as const,
        content: prompt,
        createdAt: new Date().toISOString(),
    };
    await context.stores.chat.appendMessage(userMessage);

    // 2. Build prompt context (loads profile, character, and history)
    const promptContext = await PromptContextBuilder.build({
        userId: DEFAULT_USER_ID,
        characterId: conversationId.characterId,
        conversationId: conversationId.conversationId,
        currentUserMessage: userMessage,
        messageStore: context.stores.chat,
        userProfileStore: context.stores.userProfile,
        characterStore: context.stores.character,
    });

    // 3. Render prompt
    const rendered = promptRenderer.render(promptContext);

    // 4. Call LLM
    const runtimeAgentService = await createChatAgentService(context);
    const response = await runtimeAgentService.chat({ messages: rendered.messages });

    // 5. Append assistant message
    await context.stores.chat.appendMessage({
        id: crypto.randomUUID(),
        userId: DEFAULT_USER_ID,
        conversationId: conversationId.conversationId,
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
        const requestId = `stream-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

        let prompt: string;
        try {
            prompt = requirePrompt(req.body?.prompt, "chat/stream");
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : "Unknown error";
            context.logger.error("chat/stream: invalid request", { message });
            res.status(400).json({ message });
            return;
        }

        context.logger.debug("chat/stream: request received", { promptLength: prompt.length, prompt });

        let agentService: AgentService;
        try {
            agentService = await createChatAgentService(context);
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : "Unknown error";
            context.logger.error("chat/stream: agent setup failed", { message });
            res.status(400).json({ message });
            return;
        }

        let resolved: { characterId: string; conversationId: string };
        try {
            resolved = await resolveConversationId(context);
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : "Unknown error";
            context.logger.error("chat/stream: no active character", { message });
            res.status(400).json({ message });
            return;
        }
        const { characterId, conversationId } = resolved;

        res.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"
        });

        // 1. Append user message
        const userMessage = {
            id: crypto.randomUUID(),
            userId: DEFAULT_USER_ID,
            conversationId,
            role: "user" as const,
            content: prompt,
            createdAt: new Date().toISOString(),
        };
        await context.stores.chat.appendMessage(userMessage);

        // 2. Build prompt context and render
        const promptContext = await PromptContextBuilder.build({
            userId: DEFAULT_USER_ID,
            characterId,
            conversationId,
            currentUserMessage: userMessage,
            messageStore: context.stores.chat,
            userProfileStore: context.stores.userProfile,
            characterStore: context.stores.character,
        });
        const rendered = promptRenderer.render(promptContext);

        // 3. Call LLM
        let fullResponse: string;
        try {
            const chatResponse = await agentService.chat({ messages: rendered.messages });
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
        await context.stores.chat.appendMessage({
            id: crypto.randomUUID(),
            userId: DEFAULT_USER_ID,
            conversationId,
            role: "assistant",
            content: fullResponse,
            createdAt: new Date().toISOString(),
        });

        const prefs = await context.stores.userPreferences.getUserPreferences(DEFAULT_USER_ID);
        const modelName = prefs?.functionModels?.["chat"]?.model ?? "unknown";
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

    // Dry-run endpoint: assembles the prompt without calling the LLM or persisting anything
    registerApi(context.app, ApiChatDryRun, {
        handleRequest: async (_, body) => {
            const prompt = body?.prompt ?? "";
            context.logger.debug("chat/dry-run: request received", { promptLength: prompt.length });

            const { characterId, conversationId } = await resolveConversationId(context);

            // Transient user message — not persisted
            const userMessage = {
                id: crypto.randomUUID(),
                userId: DEFAULT_USER_ID,
                conversationId,
                role: "user" as const,
                content: prompt,
                createdAt: new Date().toISOString(),
            };

            const promptContext = await PromptContextBuilder.build({
                userId: DEFAULT_USER_ID,
                characterId,
                conversationId,
                currentUserMessage: userMessage,
                messageStore: context.stores.chat,
                userProfileStore: context.stores.userProfile,
                characterStore: context.stores.character,
            });

            const rendered = promptRenderer.render(promptContext);
            return { messages: rendered.messages };
        },
        handleError: (error) => {
            const response = toErrorResponse(error);
            context.logger.error("chat/dry-run: failed", { message: response.message });
            return { status: 400, body: response };
        }
    });

    // GET /v1/conversations/:id/messages
    registerApi(context.app, ApiGetMessages, {
        handleRequest: async (req) => {
            const conversationId = req.params.id;
            const messages = await context.stores.chat.getRecentMessages({
                userId: DEFAULT_USER_ID,
                conversationId,
                limit: 200,
            });
            return {
                messages: messages
                    .filter(m => m.role === "user" || m.role === "assistant")
                    .map(m => ({
                        id: m.id,
                        role: m.role as "user" | "assistant",
                        content: m.content,
                        createdAt: m.createdAt,
                    })),
            };
        },
        handleError: (error) => ({ status: 404, body: toErrorResponse(error) }),
    });
}
