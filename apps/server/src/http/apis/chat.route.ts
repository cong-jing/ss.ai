import {
    ApiChat,
    ApiChatDryRun,
    ApiDeleteMessage,
    ApiChatStream,
    ApiGetMessages,
    type ChatDryRunRequest,
    type ChatRequest,
    type ChatStreamRequest,
    type ChatStreamEvent,
    type ConversationActorSourceType,
} from "@ss-ai/contracts";
import { PromptContextBuilder, promptRenderer } from "@ss-ai/persona-flow";
import { AgentService, createModelClientFromConfig } from "../../agent/index.js";
import { PromptLogger } from "../../util/promptLog.js";
import { registerApi } from "../registerApi.js";
import { toErrorResponse, DEFAULT_USER_ID, type HttpApiContext } from "./apiContext.js";

class HttpStatusError extends Error {
    constructor(public readonly status: number, message: string) {
        super(message);
    }
}

function getStatusCode(error: unknown, fallback = 400): number {
    return error instanceof HttpStatusError ? error.status : fallback;
}

function requireNonEmptyString(value: unknown, fieldName: string, endpoint: string): string {
    if (typeof value !== "string" || value.trim().length === 0) {
        throw new HttpStatusError(400, `${endpoint}: ${fieldName} is required.`);
    }
    return value;
}

async function createChatAgentService(context: HttpApiContext, userId: string): Promise<AgentService> {
    const prefs = await context.stores.userPreferences.getUserPreferences(userId);
    const chatFnModel = prefs?.functionModels?.["chat"];
    if (!chatFnModel?.provider || !chatFnModel?.model) {
        throw new HttpStatusError(400, "Chat model is not configured. Please set it in Settings → Model Assignment.");
    }
    const { provider, model } = chatFnModel;
    const modelEntry = context.config.models[provider];
    if (!modelEntry) {
        throw new HttpStatusError(400, `Configured provider "${provider}" is not available.`);
    }
    const credential = await context.stores.providerCredential.getCredential({ userId, provider });
    if (!credential) {
        throw new HttpStatusError(400, `API key is not set for provider: ${provider}`);
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
        throw new HttpStatusError(400, `${endpoint}: prompt is required.`);
    }
    return prompt;
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripRepeatedPrefix(text: string, regex: RegExp): string {
    let output = text;
    while (regex.test(output)) {
        output = output.replace(regex, "");
    }
    return output;
}

function normalizeAssistantOutput(output: string, names: Array<string | null | undefined>): string {
    let normalized = output.trimStart();

    // Remove generated actor alias prefixes like: p1[SS]:
    normalized = stripRepeatedPrefix(normalized, /^p\d+\[[^\]]+\]\s*[:：]\s*/u);

    const uniqueNames = Array.from(new Set(
        names
            .map(name => (typeof name === "string" ? name.trim() : ""))
            .filter(Boolean),
    ));

    for (const name of uniqueNames) {
        const escapedName = escapeRegExp(name);
        normalized = stripRepeatedPrefix(normalized, new RegExp(`^${escapedName}\\s*[:：]\\s*`, "u"));
    }

    return normalized;
}

/**
 * Resolve and validate chat target from explicit request parameters.
 * Ensures character and conversation exist and belong to the same user/character scope.
 */
async function resolveChatTarget(
    context: HttpApiContext,
    input: { userId: string; characterId: string; conversationId: string },
): Promise<{ characterId: string; conversationId: string }> {
    const { userId, characterId, conversationId } = input;

    const character = await context.stores.character.getCharacterById({ userId, characterId });
    if (!character || character.status === "archived") {
        throw new HttpStatusError(404, `Character not found: ${characterId}`);
    }

    const conversation = await context.stores.conversation.getConversationById({ userId, conversationId });
    if (!conversation) {
        throw new HttpStatusError(404, `Conversation not found: ${conversationId}`);
    }
    if (conversation.characterId !== characterId) {
        throw new HttpStatusError(404, `Conversation not found for character: ${conversationId}`);
    }

    return { characterId, conversationId };
}

/**
 * Find the self (AI) actor for a conversation.
 */
async function resolveSelfActorId(context: HttpApiContext, conversationId: string): Promise<string> {
    const actors = await context.stores.conversationActor.listConversationActors({
        conversationId,
        activeOnly: true,
    });
    const self = actors.find(p => p.role === "self");
    if (!self) throw new HttpStatusError(404, `Self actor not found for conversation ${conversationId}`);
    return self.id;
}

/**
 * Ensure a logged_user actor exists for the given userId in this conversation.
 * Creates one if it does not yet exist. Returns the actor ID.
 *
 * userId defaults to DEFAULT_USER_ID.
 */
async function ensureUserActor(
    context: HttpApiContext,
    conversationId: string,
    userId: string = DEFAULT_USER_ID,
): Promise<string> {
    const actors = await context.stores.conversationActor.listConversationActors({
        conversationId,
        activeOnly: true,
    });

    const existing = actors.find(
        p => p.sourceType === "logged_user" && p.userProfileId === userId,
    );
    if (existing) return existing.id;

    // Determine display name from user profile (fall back to userId)
    const userProfile = await context.stores.userProfile.getUserProfile(userId);
    const displayName = userProfile?.name ?? userId;

    const added = await context.stores.conversationActor.addConversationActor({
        conversationId,
        role: "other",
        sourceType: "logged_user",
        displayName,
        userProfileId: userId,
    });
    context.logger.debug("chat: added user actor", { conversationId, userId, actorId: added.id });
    return added.id;
}

async function resolveSpeakerActorId(
    context: HttpApiContext,
    input: {
        conversationId: string;
        userId: string;
        speakerActorId?: unknown;
    },
): Promise<string> {
    const requested = typeof input.speakerActorId === "string"
        ? input.speakerActorId.trim()
        : "";
    if (!requested) {
        return ensureUserActor(context, input.conversationId, input.userId);
    }

    const actors = await context.stores.conversationActor.listConversationActors({
        conversationId: input.conversationId,
        activeOnly: true,
    });
    const actor = actors.find(p => p.id === requested);
    if (!actor) {
        throw new HttpStatusError(404, `Speaker actor not found: ${requested}`);
    }
    if (actor.role !== "other") {
        throw new HttpStatusError(400, `Speaker actor is not allowed: ${requested}`);
    }
    return actor.id;
}

async function handleChat(context: HttpApiContext, body: ChatRequest & { userId?: string }) {
    const prompt = requirePrompt(body?.prompt, "chat");
    const userId = typeof body?.userId === "string" ? body.userId : DEFAULT_USER_ID;
    const characterId = requireNonEmptyString(body?.characterId, "characterId", "chat");
    const conversationId = requireNonEmptyString(body?.conversationId, "conversationId", "chat");

    context.logger.debug("chat: request received", { promptLength: prompt.length, userId, characterId, conversationId });

    await resolveChatTarget(context, { userId, characterId, conversationId });

    // Resolve actors after target validation.
    const [selfActorId, speakerActorId] = await Promise.all([
        resolveSelfActorId(context, conversationId),
        resolveSpeakerActorId(context, {
            conversationId,
            userId,
            speakerActorId: body?.speakerActorId,
        }),
    ]);

    // 1. Append user message
    const userMessage = {
        id: crypto.randomUUID(),
        conversationId,
        senderActorId: speakerActorId,
        content: prompt,
        createdAt: new Date().toISOString(),
    };
    await context.stores.chat.appendMessage(userMessage);

    // 2. Build prompt context
    const promptContext = await PromptContextBuilder.build({
        userId,
        characterId,
        conversationId,
        currentUserMessage: userMessage,
        messageStore: context.stores.chat,
        userProfileStore: context.stores.userProfile,
        characterStore: context.stores.character,
        conversationActorStore: context.stores.conversationActor,
    });

    // 3. Render prompt
    const rendered = promptRenderer.render(promptContext);

    // 4. Call LLM
    const runtimeAgentService = await createChatAgentService(context, userId);
    const response = await runtimeAgentService.chat({ messages: rendered.messages });

    const selfActor = promptContext.actorMap.get(selfActorId);
    const normalizedAssistantOutput = normalizeAssistantOutput(response.output, [
        selfActor?.displayName,
        promptContext.character?.displayName,
        promptContext.character?.name,
    ]);

    // 5. Append assistant message
    const assistantMessageId = crypto.randomUUID();
    await context.stores.chat.appendMessage({
        id: assistantMessageId,
        conversationId,
        senderActorId: selfActorId,
        content: normalizedAssistantOutput,
        createdAt: new Date().toISOString(),
    });

    return {
        ...response,
        output: normalizedAssistantOutput,
        userMessageId: userMessage.id,
        assistantMessageId,
        ...(body.includePrompt ? { promptMessages: rendered.messages } : {}),
    };
}

export function registerChatRoute(context: HttpApiContext): void {
    registerApi(context.app, ApiChat, {
        handleRequest: (_, body) => handleChat(context, body),
        handleError: (error) => {
            const response = toErrorResponse(error);
            context.logger.error("chat: failed", { message: response.message });
            return { status: getStatusCode(error), body: response };
        }
    });

    // SSE streaming endpoint
    context.app.post(ApiChatStream.apiUrl, async (req, res) => {
        const requestId = `stream-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

        let prompt: string;
        let characterId: string;
        let conversationId: string;
        let speakerActorId: string | undefined;
        try {
            prompt = requirePrompt(req.body?.prompt, "chat/stream");
            characterId = requireNonEmptyString(req.body?.characterId, "characterId", "chat/stream");
            conversationId = requireNonEmptyString(req.body?.conversationId, "conversationId", "chat/stream");
            speakerActorId = typeof req.body?.speakerActorId === "string"
                ? req.body.speakerActorId
                : undefined;
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

        let agentService: AgentService;
        try {
            agentService = await createChatAgentService(context, userId);
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : "Unknown error";
            context.logger.error("chat/stream: agent setup failed", { message });
            res.status(getStatusCode(err)).json({ message });
            return;
        }

        try {
            await resolveChatTarget(context, { userId, characterId, conversationId });
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : "Unknown error";
            context.logger.error("chat/stream: invalid target", { message });
            res.status(getStatusCode(err)).json({ message });
            return;
        }

        let selfActorId: string;
        let speakerId: string;
        try {
            [selfActorId, speakerId] = await Promise.all([
                resolveSelfActorId(context, conversationId),
                resolveSpeakerActorId(context, {
                    conversationId,
                    userId,
                    speakerActorId,
                }),
            ]);
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : "Unknown error";
            context.logger.error("chat/stream: invalid speaker", { message });
            res.status(getStatusCode(err)).json({ message });
            return;
        }

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
            senderActorId: speakerId,
            content: prompt,
            createdAt: new Date().toISOString(),
        };
        await context.stores.chat.appendMessage(userMessage);

        // 2. Build prompt context and render
        const promptContext = await PromptContextBuilder.build({
            userId,
            characterId,
            conversationId,
            currentUserMessage: userMessage,
            messageStore: context.stores.chat,
            userProfileStore: context.stores.userProfile,
            characterStore: context.stores.character,
            conversationActorStore: context.stores.conversationActor,
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
            const selfActor = promptContext.actorMap.get(selfActorId);
            fullResponse = normalizeAssistantOutput(chatResponse.output, [
                selfActor?.displayName,
                promptContext.character?.displayName,
                promptContext.character?.name,
            ]);
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
            senderActorId: selfActorId,
            content: fullResponse,
            createdAt: new Date().toISOString(),
        });

        const prefs = await context.stores.userPreferences.getUserPreferences(userId);
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
            const typedBody = body as ChatDryRunRequest & { userId?: string };
            const prompt = requirePrompt(typedBody?.prompt, "chat/dry-run");
            const characterId = requireNonEmptyString(typedBody?.characterId, "characterId", "chat/dry-run");
            const conversationId = requireNonEmptyString(typedBody?.conversationId, "conversationId", "chat/dry-run");
            const userId: string = typeof typedBody?.userId === "string"
                ? typedBody.userId
                : DEFAULT_USER_ID;
            context.logger.debug("chat/dry-run: request received", {
                promptLength: prompt.length,
                userId,
                characterId,
                conversationId,
            });

            await resolveChatTarget(context, { userId, characterId, conversationId });
            const [selfActorId, speakerActorId] = await Promise.all([
                resolveSelfActorId(context, conversationId),
                resolveSpeakerActorId(context, {
                    conversationId,
                    userId,
                    speakerActorId: typedBody?.speakerActorId,
                }),
            ]);

            // Transient user message — not persisted
            const userMessage = {
                id: crypto.randomUUID(),
                conversationId,
                senderActorId: speakerActorId,
                content: prompt,
                createdAt: new Date().toISOString(),
            };

            const promptContext = await PromptContextBuilder.build({
                userId,
                characterId,
                conversationId,
                currentUserMessage: userMessage,
                messageStore: context.stores.chat,
                userProfileStore: context.stores.userProfile,
                characterStore: context.stores.character,
                conversationActorStore: context.stores.conversationActor,
            });

            const rendered = promptRenderer.render(promptContext);
            // selfActorId is resolved but unused in dry-run (no message stored)
            void selfActorId;
            return { messages: rendered.messages };
        },
        handleError: (error) => {
            const response = toErrorResponse(error);
            context.logger.error("chat/dry-run: failed", { message: response.message });
            return { status: getStatusCode(error), body: response };
        }
    });

    // GET /v1/conversations/:id/messages
    registerApi(context.app, ApiGetMessages, {
        handleRequest: async (req) => {
            const conversationId = req.params.id;
            const conversation = await context.stores.conversation.getConversationById({
                userId: DEFAULT_USER_ID,
                conversationId,
            });
            if (!conversation) {
                throw new HttpStatusError(404, `Conversation not found: ${conversationId}`);
            }

            const [messages, actors, character] = await Promise.all([
                context.stores.chat.getRecentMessages({ userId: DEFAULT_USER_ID, conversationId, limit: 200 }),
                context.stores.conversationActor.listConversationActors({ conversationId }),
                context.stores.character.getCharacterById({
                    userId: DEFAULT_USER_ID,
                    characterId: conversation.characterId,
                }),
            ]);
            const actorMap = new Map(actors.map(p => [p.id, p]));
            return {
                messages: messages.map(m => {
                    const p = actorMap.get(m.senderActorId);
                    // self actors are AI (assistant), everything else is user
                    const role: "user" | "assistant" = p?.role === "self" ? "assistant" : "user";
                    const senderDisplayName = p?.role === "self"
                        ? (character?.displayName ?? character?.name ?? p?.displayName ?? "assistant")
                        : (p?.displayName ?? "unknown");
                    const senderSourceType: ConversationActorSourceType = p?.sourceType ?? "local_actor";
                    return {
                        id: m.id,
                        role,
                        senderActorId: m.senderActorId,
                        senderDisplayName,
                        senderSourceType,
                        content: m.content,
                        createdAt: m.createdAt,
                    };
                }),
            };
        },
        handleError: (error) => ({ status: 404, body: toErrorResponse(error) }),
    });

    // DELETE /v1/conversations/:id/messages/:messageId
    registerApi(context.app, ApiDeleteMessage, {
        handleRequest: async (req) => {
            const conversationId = req.params.id;
            const messageId = req.params.messageId;
            const conversation = await context.stores.conversation.getConversationById({
                userId: DEFAULT_USER_ID,
                conversationId,
            });
            if (!conversation) {
                throw new HttpStatusError(404, `Conversation not found: ${conversationId}`);
            }

            await context.stores.chat.deleteMessage({ conversationId, messageId });
            return { messageId };
        },
        handleError: (error) => ({ status: getStatusCode(error, 404), body: toErrorResponse(error) }),
    });
}
