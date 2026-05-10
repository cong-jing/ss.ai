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
 * Auto-creates a new conversation (with self + system participants) if no state exists yet.
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

    // Auto-create state (character exists but has no state record yet)
    const character = await context.stores.character.getCharacterById({ userId: DEFAULT_USER_ID, characterId });
    const selfDisplayName = character?.displayName ?? character?.name ?? "AI";

    const conversationId = crypto.randomUUID();
    const now = new Date().toISOString();
    await context.stores.conversation.createConversation(
        { id: conversationId, userId: DEFAULT_USER_ID, characterId, title: null, createdAt: now, updatedAt: now },
        { selfDisplayName },
    );
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

/**
 * Find the self (AI) participant for a conversation.
 */
async function resolveSelfParticipantId(context: HttpApiContext, conversationId: string): Promise<string> {
    const participants = await context.stores.conversationParticipant.listConversationParticipants({
        conversationId,
        activeOnly: true,
    });
    const self = participants.find(p => p.role === "self");
    if (!self) throw new Error(`Self participant not found for conversation ${conversationId}`);
    return self.id;
}

/**
 * Ensure a logged_user participant exists for the given userId in this conversation.
 * Creates one if it does not yet exist. Returns the participant ID.
 *
 * userId defaults to DEFAULT_USER_ID.
 */
async function ensureUserParticipant(
    context: HttpApiContext,
    conversationId: string,
    userId: string = DEFAULT_USER_ID,
): Promise<string> {
    const participants = await context.stores.conversationParticipant.listConversationParticipants({
        conversationId,
        activeOnly: true,
    });

    const existing = participants.find(
        p => p.sourceType === "logged_user" && p.userProfileId === userId,
    );
    if (existing) return existing.id;

    // Determine display name from user profile (fall back to userId)
    const userProfile = await context.stores.userProfile.getUserProfile(userId);
    const displayName = userProfile?.name ?? userId;

    const added = await context.stores.conversationParticipant.addConversationParticipant({
        conversationId,
        role: "other",
        sourceType: "logged_user",
        displayName,
        userProfileId: userId,
    });
    context.logger.debug("chat: added user participant", { conversationId, userId, participantId: added.id });
    return added.id;
}

async function handleChat(context: HttpApiContext, body: ChatRequest & { userId?: string }) {
    const prompt = requirePrompt(body?.prompt, "chat");
    const userId = typeof body?.userId === "string" ? body.userId : DEFAULT_USER_ID;

    context.logger.debug("chat: request received", { promptLength: prompt.length, userId });

    const { characterId, conversationId } = await resolveConversationId(context);

    // Resolve participant IDs (both may be fetched in parallel after we have conversationId)
    const [selfParticipantId, userParticipantId] = await Promise.all([
        resolveSelfParticipantId(context, conversationId),
        ensureUserParticipant(context, conversationId, userId),
    ]);

    // 1. Append user message
    const userMessage = {
        id: crypto.randomUUID(),
        conversationId,
        senderParticipantId: userParticipantId,
        content: prompt,
        createdAt: new Date().toISOString(),
    };
    await context.stores.chat.appendMessage(userMessage);

    // 2. Build prompt context
    const promptContext = await PromptContextBuilder.build({
        userId: DEFAULT_USER_ID,
        characterId,
        conversationId,
        currentUserMessage: userMessage,
        messageStore: context.stores.chat,
        userProfileStore: context.stores.userProfile,
        characterStore: context.stores.character,
        conversationParticipantStore: context.stores.conversationParticipant,
    });

    // 3. Render prompt
    const rendered = promptRenderer.render(promptContext);

    // 4. Call LLM
    const runtimeAgentService = await createChatAgentService(context);
    const response = await runtimeAgentService.chat({ messages: rendered.messages });

    // 5. Append assistant message
    await context.stores.chat.appendMessage({
        id: crypto.randomUUID(),
        conversationId,
        senderParticipantId: selfParticipantId,
        content: response.output,
        createdAt: new Date().toISOString(),
    });

    return {
        ...response,
        ...(body.includePrompt ? { promptMessages: rendered.messages } : {}),
    };
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

        const userId: string = typeof req.body?.userId === "string" ? req.body.userId : DEFAULT_USER_ID;
        context.logger.debug("chat/stream: request received", { promptLength: prompt.length, userId });

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

        const [selfParticipantId, userParticipantId] = await Promise.all([
            resolveSelfParticipantId(context, conversationId),
            ensureUserParticipant(context, conversationId, userId),
        ]);

        res.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        });

        // 1. Append user message
        const userMessage = {
            id: crypto.randomUUID(),
            conversationId,
            senderParticipantId: userParticipantId,
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
            conversationParticipantStore: context.stores.conversationParticipant,
        });
        const rendered = promptRenderer.render(promptContext);

        // 2b. Emit assembled prompt as SSE event when requested
        if (req.body?.includePrompt) {
            const promptEvent: ChatStreamEvent = { type: "prompt", messages: rendered.messages };
            res.write(`data: ${JSON.stringify(promptEvent)}\n\n`);
        }

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
            conversationId,
            senderParticipantId: selfParticipantId,
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
            const userId: string = typeof (body as { userId?: string })?.userId === "string"
                ? (body as { userId?: string }).userId!
                : DEFAULT_USER_ID;
            context.logger.debug("chat/dry-run: request received", { promptLength: prompt.length });

            const { characterId, conversationId } = await resolveConversationId(context);
            const [selfParticipantId, userParticipantId] = await Promise.all([
                resolveSelfParticipantId(context, conversationId),
                ensureUserParticipant(context, conversationId, userId),
            ]);

            // Transient user message — not persisted
            const userMessage = {
                id: crypto.randomUUID(),
                conversationId,
                senderParticipantId: userParticipantId,
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
                conversationParticipantStore: context.stores.conversationParticipant,
            });

            const rendered = promptRenderer.render(promptContext);
            // selfParticipantId is resolved but unused in dry-run (no message stored)
            void selfParticipantId;
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
            const [messages, participants] = await Promise.all([
                context.stores.chat.getRecentMessages({ conversationId, limit: 200 }),
                context.stores.conversationParticipant.listConversationParticipants({ conversationId }),
            ]);
            const participantMap = new Map(participants.map(p => [p.id, p]));
            return {
                messages: messages.map(m => {
                    const p = participantMap.get(m.senderParticipantId);
                    // self participants are AI (assistant), everything else is user
                    const role: "user" | "assistant" = p?.role === "self" ? "assistant" : "user";
                    return { id: m.id, role, content: m.content, createdAt: m.createdAt };
                }),
            };
        },
        handleError: (error) => ({ status: 404, body: toErrorResponse(error) }),
    });
}
