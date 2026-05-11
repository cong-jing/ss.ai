import {
    ApiListConversations,
    ApiCreateConversation,
    ApiSelectConversation,
    ApiDeleteConversation,
    type ConversationInfo,
} from "@ss-ai/contracts";
import type { Conversation } from "@ss-ai/persona-flow";
import { registerApi } from "../registerApi.js";
import { toErrorResponse, DEFAULT_USER_ID, type HttpApiContext } from "./apiContext.js";

function toContractConversation(c: Conversation): ConversationInfo {
    return { id: c.id, title: c.title, createdAt: c.createdAt, updatedAt: c.updatedAt };
}

export function registerConversationRoutes(context: HttpApiContext): void {
    const store = context.stores.character;

    registerApi(context.app, ApiListConversations, {
        handleRequest: async (req) => {
            const characterId = req.params.id;
            const character = await store.getCharacterById({ userId: DEFAULT_USER_ID, characterId });
            if (!character || character.status === "archived") {
                throw new Error(`Character not found: ${characterId}`);
            }
            const [state, convList] = await Promise.all([
                context.stores.chat.getCharacterState({ userId: DEFAULT_USER_ID, characterId }),
                context.stores.conversation.listConversations({ userId: DEFAULT_USER_ID, characterId }),
            ]);
            return {
                conversations: convList.map(toContractConversation),
                activeConversationId: state?.currentConversationId ?? null,
            };
        },
        handleError: (error) => ({ status: 404, body: toErrorResponse(error) }),
    });

    registerApi(context.app, ApiCreateConversation, {
        handleRequest: async (req) => {
            const characterId = req.params.id;
            const character = await store.getCharacterById({ userId: DEFAULT_USER_ID, characterId });
            if (!character || character.status === "archived") {
                throw new Error(`Character not found: ${characterId}`);
            }
            const now = new Date().toISOString();
            const conversationId = crypto.randomUUID();
            await context.stores.conversation.createConversation({
                id: conversationId,
                userId: DEFAULT_USER_ID,
                characterId,
                title: null,
                createdAt: now,
                updatedAt: now,
            }, { selfDisplayName: character.displayName ?? character.name });
            const userProfile = await context.stores.userProfile.getUserProfile(DEFAULT_USER_ID);
            await context.stores.conversationActor.addConversationActor({
                conversationId,
                role: "other",
                sourceType: "logged_user",
                displayName: userProfile?.name ?? DEFAULT_USER_ID,
                userProfileId: DEFAULT_USER_ID,
            });
            await context.stores.chat.upsertCharacterState({
                userId: DEFAULT_USER_ID,
                characterId,
                currentConversationId: conversationId,
                createdAt: now,
                updatedAt: now,
            });
            const convList = await context.stores.conversation.listConversations({ userId: DEFAULT_USER_ID, characterId });
            return {
                conversationId,
                conversations: convList.map(toContractConversation),
                activeConversationId: conversationId,
            };
        },
        handleError: (error) => ({ status: 404, body: toErrorResponse(error) }),
    });

    registerApi(context.app, ApiSelectConversation, {
        handleRequest: async (req, body) => {
            const characterId = req.params.id;
            const conversationId = typeof body?.conversationId === "string" ? body.conversationId : "";
            const character = await store.getCharacterById({ userId: DEFAULT_USER_ID, characterId });
            if (!character || character.status === "archived") {
                throw new Error(`Character not found: ${characterId}`);
            }
            const convList = await context.stores.conversation.listConversations({ userId: DEFAULT_USER_ID, characterId });
            if (!convList.some(c => c.id === conversationId)) {
                throw new Error(`Conversation not found: ${conversationId}`);
            }
            const now = new Date().toISOString();
            await context.stores.chat.upsertCharacterState({
                userId: DEFAULT_USER_ID,
                characterId,
                currentConversationId: conversationId,
                createdAt: now,
                updatedAt: now,
            });
            return { conversationId, conversations: convList.map(toContractConversation) };
        },
        handleError: (error) => ({ status: 400, body: toErrorResponse(error) }),
    });

    registerApi(context.app, ApiDeleteConversation, {
        handleRequest: async (req) => {
            const characterId = req.params.id;
            const convId = req.params.convId;
            const character = await store.getCharacterById({ userId: DEFAULT_USER_ID, characterId });
            if (!character || character.status === "archived") {
                throw new Error(`Character not found: ${characterId}`);
            }

            const existingConversation = await context.stores.conversation.getConversationById({
                userId: DEFAULT_USER_ID,
                conversationId: convId,
            });
            if (!existingConversation || existingConversation.characterId !== characterId) {
                throw new Error(`Conversation not found: ${convId}`);
            }

            const state = await context.stores.chat.getCharacterState({ userId: DEFAULT_USER_ID, characterId });
            await context.stores.conversation.deleteConversation({ userId: DEFAULT_USER_ID, conversationId: convId });

            let remaining = await context.stores.conversation.listConversations({ userId: DEFAULT_USER_ID, characterId });
            let activeConversationId: string | null = state?.currentConversationId ?? null;

            if (state?.currentConversationId === convId) {
                if (remaining.length > 0) {
                    activeConversationId = remaining[0].id;
                } else {
                    const now = new Date().toISOString();
                    const newConvId = crypto.randomUUID();
                    await context.stores.conversation.createConversation({
                        id: newConvId,
                        userId: DEFAULT_USER_ID,
                        characterId,
                        title: null,
                        createdAt: now,
                        updatedAt: now,
                    }, { selfDisplayName: character.displayName ?? character.name });
                    const userProfile = await context.stores.userProfile.getUserProfile(DEFAULT_USER_ID);
                    await context.stores.conversationActor.addConversationActor({
                        conversationId: newConvId,
                        role: "other",
                        sourceType: "logged_user",
                        displayName: userProfile?.name ?? DEFAULT_USER_ID,
                        userProfileId: DEFAULT_USER_ID,
                    });
                    activeConversationId = newConvId;
                    remaining = [{ id: newConvId, userId: DEFAULT_USER_ID, characterId, title: null, createdAt: now, updatedAt: now }];
                }
                await context.stores.chat.upsertCharacterState({
                    userId: DEFAULT_USER_ID,
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
        handleError: (error) => ({ status: 404, body: toErrorResponse(error) }),
    });
}
