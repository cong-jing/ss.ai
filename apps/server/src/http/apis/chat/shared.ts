import type { ChatMode } from "@ss-ai/contracts";
import { PromptContextBuilder, promptRenderer } from "@ss-ai/persona-flow";
import { AgentService, createModelClientFromConfig } from "../../../agent/index.js";
import { PromptLogger } from "../../../util/promptLog.js";
import { DEFAULT_USER_ID, type HttpApiContext } from "../apiContext.js";

export class HttpStatusError extends Error {
    constructor(public readonly status: number, message: string) {
        super(message);
    }
}

export function getStatusCode(error: unknown, fallback = 400): number {
    return error instanceof HttpStatusError ? error.status : fallback;
}

export function requireNonEmptyString(value: unknown, fieldName: string, endpoint: string): string {
    if (typeof value !== "string" || value.trim().length === 0) {
        throw new HttpStatusError(400, `${endpoint}: ${fieldName} is required.`);
    }
    return value;
}

export function requirePrompt(prompt: unknown, endpoint: string): string {
    if (typeof prompt !== "string" || prompt.trim().length === 0) {
        throw new HttpStatusError(400, `${endpoint}: prompt is required.`);
    }
    return prompt;
}

export function resolveChatMode(value: unknown, endpoint: string, defaultMode: ChatMode): ChatMode {
    if (value === undefined || value === null || value === "") {
        return defaultMode;
    }
    if (value === "structured" || value === "non-structured") {
        return value;
    }
    throw new HttpStatusError(400, `${endpoint}: mode must be 'structured' or 'non-structured'.`);
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

export function normalizeAssistantOutput(output: string, names: Array<string | null | undefined>): string {
    let normalized = output.trimStart();

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

export async function createChatAgentService(context: HttpApiContext, userId: string): Promise<AgentService> {
    const prefs = await context.stores.userPreferences.getUserPreferences(userId);
    const chatFnModel = prefs?.functionModels?.["chat"];
    if (!chatFnModel?.provider || !chatFnModel?.model) {
        throw new HttpStatusError(400, "Chat model is not configured. Please set it in Settings -> Model Assignment.");
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

export async function resolveChatTarget(
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

export async function resolveSelfActorId(context: HttpApiContext, conversationId: string): Promise<string> {
    const actors = await context.stores.conversationActor.listConversationActors({
        conversationId,
        activeOnly: true,
    });
    const self = actors.find(p => p.role === "self");
    if (!self) throw new HttpStatusError(404, `Self actor not found for conversation ${conversationId}`);
    return self.id;
}

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

export async function resolveSpeakerActorId(
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

export async function prepareChatTurnContext(
    context: HttpApiContext,
    input: {
        userId: string;
        characterId: string;
        conversationId: string;
        prompt: string;
        mode: ChatMode;
        speakerActorId?: unknown;
        persistUserMessage?: boolean;
    },
) {
    const { userId, characterId, conversationId, prompt, mode } = input;
    const persistUserMessage = input.persistUserMessage ?? true;

    await resolveChatTarget(context, { userId, characterId, conversationId });

    const [selfActorId, resolvedSpeakerActorId] = await Promise.all([
        resolveSelfActorId(context, conversationId),
        resolveSpeakerActorId(context, {
            conversationId,
            userId,
            speakerActorId: input.speakerActorId,
        }),
    ]);

    const userMessage = {
        id: crypto.randomUUID(),
        conversationId,
        senderActorId: resolvedSpeakerActorId,
        content: prompt,
        createdAt: new Date().toISOString(),
    };

    if (persistUserMessage) {
        await context.stores.chat.appendMessage(userMessage);
    }

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

    const rendered = promptRenderer.render(promptContext, { mode });

    return {
        selfActorId,
        speakerActorId: resolvedSpeakerActorId,
        userMessage,
        promptContext,
        rendered,
    };
}
