import {
    ApiListConversationActors,
    ApiCreateConversationActor,
    ApiUpdateConversationActor,
    ApiDeleteConversationActor,
    type ConversationActor,
} from "@ss-ai/contracts";
import type { ConversationActor as StoreConversationActor } from "@ss-ai/persona-flow";
import { registerApi } from "../registerApi.js";
import { toErrorResponse, DEFAULT_USER_ID, type HttpApiContext } from "./apiContext.js";

function requireNonEmptyString(value: unknown, fieldName: string, endpoint: string): string {
    if (typeof value !== "string" || value.trim().length === 0) {
        throw new Error(`${endpoint}: ${fieldName} is required.`);
    }
    return value;
}

async function ensureConversation(context: HttpApiContext, conversationId: string) {
    const conversation = await context.stores.conversation.getConversationById({
        userId: DEFAULT_USER_ID,
        conversationId,
    });
    if (!conversation) {
        throw new Error(`Conversation not found: ${conversationId}`);
    }
    return conversation;
}

function toActor(actor: StoreConversationActor): ConversationActor {
    return {
        id: actor.id,
        conversationId: actor.conversationId,
        displayName: actor.displayName,
        sourceType: actor.sourceType,
        userProfileId: actor.userProfileId,
        characterId: actor.characterId,
        profileSnapshotJson: actor.profileSnapshotJson,
        leftAt: actor.leftAt,
        createdAt: actor.createdAt,
        updatedAt: actor.updatedAt,
    };
}

export function registerConversationActorRoutes(context: HttpApiContext): void {
    registerApi(context.app, ApiListConversationActors, {
        handleRequest: async (req) => {
            const conversationId = req.params.id;
            await ensureConversation(context, conversationId);
            const actors = await context.stores.conversationActor.listConversationActors({
                conversationId,
                activeOnly: true,
            });
            return { actors: actors.map(toActor) };
        },
        handleError: (error) => ({ status: 404, body: toErrorResponse(error) }),
    });

    registerApi(context.app, ApiCreateConversationActor, {
        handleRequest: async (req, body) => {
            const conversationId = req.params.id;
            await ensureConversation(context, conversationId);
            const displayName = requireNonEmptyString(body?.displayName, "displayName", "create actor").trim();
            const profileSnapshotJson = typeof body?.profileSnapshotJson === "string"
                ? body.profileSnapshotJson
                : null;

            const actor = await context.stores.conversationActor.addConversationActor({
                conversationId,
                role: "other",
                sourceType: "local_actor",
                displayName,
                profileSnapshotJson,
            });
            return { actor: toActor(actor) };
        },
        handleError: (error) => ({ status: 400, body: toErrorResponse(error) }),
    });

    registerApi(context.app, ApiUpdateConversationActor, {
        handleRequest: async (req, body) => {
            const conversationId = req.params.id;
            const actorId = req.params.actorId;
            await ensureConversation(context, conversationId);
            const actor = await context.stores.conversationActor.getActorById(actorId);
            if (!actor || actor.conversationId !== conversationId || actor.leftAt) {
                throw new Error(`Actor not found: ${actorId}`);
            }
            if (actor.sourceType !== "local_actor") {
                throw new Error(`Actor cannot be edited: ${actorId}`);
            }

            const patch: { displayName?: string; profileSnapshotJson?: string | null } = {};
            if (typeof body?.displayName === "string") {
                const name = body.displayName.trim();
                if (!name) {
                    throw new Error("update actor: displayName cannot be empty.");
                }
                patch.displayName = name;
            }
            if (body && Object.prototype.hasOwnProperty.call(body, "profileSnapshotJson")) {
                if (body.profileSnapshotJson !== null && typeof body.profileSnapshotJson !== "string") {
                    throw new Error("update actor: profileSnapshotJson must be a string or null.");
                }
                patch.profileSnapshotJson = body.profileSnapshotJson as string | null;
            }

            await context.stores.conversationActor.updateConversationActor({
                id: actorId,
                ...patch,
            });
            const updated = await context.stores.conversationActor.getActorById(actorId);
            if (!updated) {
                throw new Error(`Actor not found: ${actorId}`);
            }
            return { actor: toActor(updated) };
        },
        handleError: (error) => ({ status: 400, body: toErrorResponse(error) }),
    });

    registerApi(context.app, ApiDeleteConversationActor, {
        handleRequest: async (req) => {
            const conversationId = req.params.id;
            const actorId = req.params.actorId;
            await ensureConversation(context, conversationId);
            const actor = await context.stores.conversationActor.getActorById(actorId);
            if (!actor || actor.conversationId !== conversationId || actor.leftAt) {
                throw new Error(`Actor not found: ${actorId}`);
            }
            if (actor.sourceType !== "local_actor" && actor.sourceType !== "logged_user") {
                throw new Error(`Actor cannot be deleted: ${actorId}`);
            }

            await context.stores.conversationActor.updateConversationActor({
                id: actorId,
                leftAt: new Date().toISOString(),
            });
            return { actorId };
        },
        handleError: (error) => ({ status: 400, body: toErrorResponse(error) }),
    });
}
