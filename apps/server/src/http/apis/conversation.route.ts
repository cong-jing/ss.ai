import {
    ApiListConversations,
    ApiCreateConversation,
    ApiSelectConversation,
    ApiDeleteConversation,
    type ConversationInfo,
} from "@ss-ai/contracts";
import type { Conversation } from "@ss-ai/persona-flow";
import { registerApi } from "../registerApi.js";
import { resolveRequestUserId, toErrorResponse, type HttpApiContext } from "./apiContext.js";
import { AppHttpError, getAppErrorStatusCode } from "../errors/appHttpError.js";

function toContractConversation(c: Conversation): ConversationInfo {
    return { id: c.id, title: c.title, createdAt: c.createdAt, updatedAt: c.updatedAt };
}

export function registerConversationRoutes(context: HttpApiContext): void {
    const store = context.stores.character;

    registerApi(context.app, ApiListConversations, {
        handleRequest: async (req) => {
            const userId = await resolveRequestUserId(req, context);
            const characterId = req.params.id;
            const character = await store.getCharacterById({ userId, characterId });
            if (!character || character.status === "archived") {
                throw new AppHttpError(404, "character.not_found", `Character not found: ${characterId}`);
            }
            const [state, convList] = await Promise.all([
                context.stores.chat.getCharacterState({ userId, characterId }),
                context.stores.conversation.listConversations({ userId, characterId }),
            ]);
            return {
                conversations: convList.map(toContractConversation),
                activeConversationId: state?.currentConversationId ?? null,
            };
        },
        handleError: (error) => ({ status: getAppErrorStatusCode(error, 404), body: toErrorResponse(error) }),
    });

    registerApi(context.app, ApiCreateConversation, {
        handleRequest: async (req) => {
            const userId = await resolveRequestUserId(req, context);
            const characterId = req.params.id;
            const character = await store.getCharacterById({ userId, characterId });
            if (!character || character.status === "archived") {
                throw new AppHttpError(404, "character.not_found", `Character not found: ${characterId}`);
            }
            const now = new Date().toISOString();
            const conversationId = crypto.randomUUID();
            await context.stores.conversation.createConversation({
                id: conversationId,
                userId,
                characterId,
                title: "new chat",
                createdAt: now,
                updatedAt: now,
            }, { selfDisplayName: character.displayName ?? character.name });
            const userProfile = await context.stores.userProfile.getUserProfile(userId);
            await context.stores.conversationActor.addConversationActor({
                conversationId,
                role: "other",
                sourceType: "logged_user",
                displayName: userProfile?.name ?? userId,
                userProfileId: userId,
            });
            await context.stores.chat.upsertCharacterState({
                userId,
                characterId,
                currentConversationId: conversationId,
                createdAt: now,
                updatedAt: now,
            });
            const convList = await context.stores.conversation.listConversations({ userId, characterId });
            return {
                conversationId,
                conversations: convList.map(toContractConversation),
                activeConversationId: conversationId,
            };
        },
        handleError: (error) => ({ status: getAppErrorStatusCode(error, 404), body: toErrorResponse(error) }),
    });

    registerApi(context.app, ApiSelectConversation, {
        handleRequest: async (req, body) => {
            const userId = await resolveRequestUserId(req, context);
            const characterId = req.params.id;
            const conversationId = typeof body?.conversationId === "string" ? body.conversationId : "";
            const character = await store.getCharacterById({ userId, characterId });
            if (!character || character.status === "archived") {
                throw new AppHttpError(404, "character.not_found", `Character not found: ${characterId}`);
            }
            const convList = await context.stores.conversation.listConversations({ userId, characterId });
            if (!convList.some(c => c.id === conversationId)) {
                throw new AppHttpError(400, "conversation.not_found", `Conversation not found: ${conversationId}`);
            }
            const now = new Date().toISOString();
            await context.stores.chat.upsertCharacterState({
                userId,
                characterId,
                currentConversationId: conversationId,
                createdAt: now,
                updatedAt: now,
            });
            return { conversationId, conversations: convList.map(toContractConversation) };
        },
        handleError: (error) => ({ status: getAppErrorStatusCode(error, 400), body: toErrorResponse(error) }),
    });

    registerApi(context.app, ApiDeleteConversation, {
        handleRequest: async (req) => {
            const userId = await resolveRequestUserId(req, context);
            const characterId = req.params.id;
            const convId = req.params.convId;
            const character = await store.getCharacterById({ userId, characterId });
            if (!character || character.status === "archived") {
                throw new AppHttpError(404, "character.not_found", `Character not found: ${characterId}`);
            }

            const existingConversation = await context.stores.conversation.getConversationById({
                userId,
                conversationId: convId,
            });
            if (!existingConversation || existingConversation.characterId !== characterId) {
                throw new AppHttpError(404, "conversation.not_found", `Conversation not found: ${convId}`);
            }

            const state = await context.stores.chat.getCharacterState({ userId, characterId });
            await context.stores.conversation.deleteConversation({ userId, conversationId: convId });

            let remaining = await context.stores.conversation.listConversations({ userId, characterId });
            let activeConversationId: string | null = state?.currentConversationId ?? null;

            if (state?.currentConversationId === convId) {
                if (remaining.length > 0) {
                    activeConversationId = remaining[0].id;
                } else {
                    const now = new Date().toISOString();
                    const newConvId = crypto.randomUUID();
                    await context.stores.conversation.createConversation({
                        id: newConvId,
                        userId,
                        characterId,
                        title: "new chat",
                        createdAt: now,
                        updatedAt: now,
                    }, { selfDisplayName: character.displayName ?? character.name });
                    const userProfile = await context.stores.userProfile.getUserProfile(userId);
                    await context.stores.conversationActor.addConversationActor({
                        conversationId: newConvId,
                        role: "other",
                        sourceType: "logged_user",
                        displayName: userProfile?.name ?? userId,
                        userProfileId: userId,
                    });
                    activeConversationId = newConvId;
                    remaining = [{ id: newConvId, userId, characterId, title: "new chat", createdAt: now, updatedAt: now }];
                }
                await context.stores.chat.upsertCharacterState({
                    userId,
                    characterId,
                    currentConversationId: activeConversationId,
                    createdAt: state?.createdAt ?? new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                });
            }

            return {
                conversations: remaining.map(toContractConversation),
                activeConversationId,
            };
        },
        handleError: (error) => ({ status: getAppErrorStatusCode(error, 404), body: toErrorResponse(error) }),
    });

    context.app.patch("/v1/characters/:id/conversations/:convId", async (req, res) => {
        try {
            const userId = await resolveRequestUserId(req, context);
            const characterId = req.params.id;
            const convId = req.params.convId;
            const character = await store.getCharacterById({ userId, characterId });
            if (!character || character.status === "archived") {
                throw new AppHttpError(404, "character.not_found", `Character not found: ${characterId}`);
            }

            const existingConversation = await context.stores.conversation.getConversationById({
                userId,
                conversationId: convId,
            });
            if (!existingConversation || existingConversation.characterId !== characterId) {
                throw new AppHttpError(404, "conversation.not_found", `Conversation not found: ${convId}`);
            }

            const title = typeof req.body?.title === "string" ? req.body.title.trim() || null : null;
            const updatedAt = new Date().toISOString();
            await context.stores.conversation.updateConversationTitle({
                userId,
                conversationId: convId,
                title,
                updatedAt,
            });

            const convList = await context.stores.conversation.listConversations({ userId, characterId });
            const updated = convList.find((c) => c.id === convId);
            res.json({
                conversation: updated ? toContractConversation(updated) : null,
                conversations: convList.map(toContractConversation),
            });
        } catch (error) {
            res.status(getAppErrorStatusCode(error, 404)).json(toErrorResponse(error));
        }
    });
}
