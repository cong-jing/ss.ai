import {
    ApiListCharacters,
    ApiCreateCharacter,
    ApiGetCharacter,
    ApiUpdateCharacter,
    ApiDeleteCharacter,
    ApiGetActiveCharacter,
    ApiSetActiveCharacter,
    ApiListCharacterInteractionModes,
    ApiListCharacterTemplates,
    DEFAULT_INTERACTION_MODE,
    INTERACTION_MODES,
    type CreateCharacterRequest,
    type ListCharacterTemplatesRequest,
    type UpdateCharacterRequest,
    type ListCharactersResponse,
    type Character as ContractCharacter,
    type ConversationInfo,
    type InteractionMode as ContractInteractionMode,
} from "@ss-ai/contracts";
import type { Character as PFCharacter, Conversation } from "@ss-ai/persona-flow";
import { registerApi } from "../registerApi.js";
import { resolveRequestUserId, toErrorResponse, type HttpApiContext } from "./apiContext.js";
import { AppHttpError, getAppErrorStatusCode } from "../errors/appHttpError.js";
import { isPromptLanguage, listCharacterTemplates } from "../../characterTemplates/characterTemplateService.js";

// ── Projections ────────────────────────────────────────────────────────────────

function toContractCharacter(c: PFCharacter): ContractCharacter {
    const rawConfig = c.modelConfig as Record<string, unknown>;
    const modelConfig: ContractCharacter['modelConfig'] = {} as ContractCharacter['modelConfig'];
    for (const [key, val] of Object.entries(rawConfig)) {
        if (val && typeof val === 'object') {
            const v = val as Record<string, unknown>;
            if (typeof v.provider === 'string' && typeof v.model === 'string') {
                (modelConfig as Record<string, { provider: string; model: string }>)[key] = { provider: v.provider, model: v.model };
            }
        }
    }
    return {
        id: c.id,
        name: c.name,
        displayName: c.displayName ?? null,
        description: c.description ?? "",
        personaPrompt: c.personaPrompt,
        greetingMessage: c.greetingMessage ?? null,
        modelConfig,
        interactionMode: c.interactionMode ?? DEFAULT_INTERACTION_MODE,
        language: isPromptLanguage(c.language) ? c.language : "zh-CN",
        status: c.status,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
    };
}

function normalizeInteractionMode(value: unknown): ContractInteractionMode | undefined {
    if (typeof value !== "string") return undefined;
    return (INTERACTION_MODES as readonly string[]).includes(value) ? value as ContractInteractionMode : undefined;
}

function toContractConversation(c: Conversation): ConversationInfo {
    return { id: c.id, title: c.title, createdAt: c.createdAt, updatedAt: c.updatedAt };
}

export function registerCharacterRoutes(context: HttpApiContext): void {
    const store = context.stores.character;
    // GET /v1/characters
    registerApi(context.app, ApiListCharacters, {
        handleRequest: async (req): Promise<ListCharactersResponse> => {
            const userId = await resolveRequestUserId(req, context);
            const list = await store.listCharacters({ userId, status: "active" });
            const prefs = await context.stores.userPreferences.getUserPreferences(userId);
            return {
                characters: list.map(toContractCharacter),
                activeCharacterId: prefs?.currentCharacterId ?? null,
            };
        },
    });

    // POST /v1/characters
    registerApi(context.app, ApiCreateCharacter, {
        handleRequest: async (req, body: CreateCharacterRequest) => {
            const userId = await resolveRequestUserId(req, context);
            const name = typeof body?.name === "string" ? body.name.trim() : "";
            if (!name) throw new AppHttpError(400, "character.name_required", "name is required");
            const now = new Date().toISOString();
            const character: PFCharacter = {
                id: crypto.randomUUID(),
                userId,
                name,
                displayName: typeof body.displayName === "string" ? body.displayName.trim() || null : null,
                description: typeof body.description === "string" ? body.description.trim() || null : null,
                personaPrompt: typeof body.personaPrompt === "string" ? body.personaPrompt.trim() : "",
                greetingMessage: typeof body.greetingMessage === "string" ? body.greetingMessage.trim() || null : null,
                avatarUrl: null,
                modelConfig: {},
                interactionMode: normalizeInteractionMode(body.interactionMode) ?? DEFAULT_INTERACTION_MODE,
                generationConfig: {},
                memoryConfig: {},
                language: isPromptLanguage(body.language) ? body.language : "zh-CN",
                status: "active",
                createdAt: now,
                updatedAt: now,
            };
            await store.createCharacter(character);

            // Auto-create per-character conversation state + first conversation record
            const conversationId = crypto.randomUUID();
            await context.stores.conversation.createConversation({
                id: conversationId,
                userId,
                characterId: character.id,
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
                characterId: character.id,
                currentConversationId: conversationId,
                createdAt: now,
                updatedAt: now,
            });

            return toContractCharacter(character);
        },
        handleError: (error) => ({ status: getAppErrorStatusCode(error, 400), body: toErrorResponse(error) }),
    });

    // GET /v1/characters/:id
    registerApi(context.app, ApiGetCharacter, {
        handleRequest: async (req) => {
            const userId = await resolveRequestUserId(req, context);
            const character = await store.getCharacterById({ userId, characterId: req.params.id });
            if (!character) throw new AppHttpError(404, "character.not_found", `Character not found: ${req.params.id}`);
            return toContractCharacter(character);
        },
        handleError: (error) => ({ status: getAppErrorStatusCode(error, 404), body: toErrorResponse(error) }),
    });

    // PATCH /v1/characters/:id
    registerApi(context.app, ApiUpdateCharacter, {
        handleRequest: async (req, body: UpdateCharacterRequest) => {
            const userId = await resolveRequestUserId(req, context);
            const existing = await store.getCharacterById({ userId, characterId: req.params.id });
            if (!existing || existing.status === "archived") {
                throw new AppHttpError(404, "character.not_found", `Character not found: ${req.params.id}`);
            }
            const hasBodyProperty = (key: keyof UpdateCharacterRequest): boolean => (
                body != null && Object.prototype.hasOwnProperty.call(body, key)
            );
            const patch: Partial<Omit<PFCharacter, "id" | "userId" | "createdAt">> = {
                updatedAt: new Date().toISOString(),
            };
            if (typeof body?.name === "string") patch.name = body.name.trim();
            if (hasBodyProperty("displayName")) {
                patch.displayName = typeof body.displayName === "string" ? body.displayName.trim() || null : null;
            }
            if (typeof body?.description === "string") patch.description = body.description.trim() || null;
            if (typeof body?.personaPrompt === "string") patch.personaPrompt = body.personaPrompt.trim();
            if (hasBodyProperty("greetingMessage")) {
                patch.greetingMessage = typeof body.greetingMessage === "string"
                    ? body.greetingMessage.trim() || null
                    : null;
            }
            if (hasBodyProperty("interactionMode")) {
                throw new AppHttpError(400, "character.interaction_mode_immutable", "interactionMode can only be set at character creation");
            }
            if (isPromptLanguage(body?.language)) patch.language = body.language;
            if (hasBodyProperty("modelConfig")
                && body.modelConfig !== null && typeof body.modelConfig === "object") {
                patch.modelConfig = body.modelConfig as Record<string, unknown>;
            }
            await store.updateCharacter({ userId, characterId: req.params.id, patch });
            const updated = await store.getCharacterById({ userId, characterId: req.params.id });
            return toContractCharacter(updated!);
        },
        handleError: (error) => ({ status: getAppErrorStatusCode(error, 404), body: toErrorResponse(error) }),
    });

    // DELETE /v1/characters/:id
    registerApi(context.app, ApiDeleteCharacter, {
        handleRequest: async (req) => {
            const userId = await resolveRequestUserId(req, context);
            const existing = await store.getCharacterById({ userId, characterId: req.params.id });
            if (!existing || existing.status === "archived") {
                throw new AppHttpError(404, "character.not_found", `Character not found: ${req.params.id}`);
            }
            await store.archiveCharacter({ userId, characterId: req.params.id, updatedAt: new Date().toISOString() });
        },
        handleError: (error) => ({ status: getAppErrorStatusCode(error, 404), body: toErrorResponse(error) }),
    });

    // ── Active character ────────────────────────────────────────────────────────

    registerApi(context.app, ApiGetActiveCharacter, {
        handleRequest: async (req) => {
            const userId = await resolveRequestUserId(req, context);
            const prefs = await context.stores.userPreferences.getUserPreferences(userId);
            return { characterId: prefs?.currentCharacterId ?? null };
        },
    });

    registerApi(context.app, ApiSetActiveCharacter, {
        handleRequest: async (req, body) => {
            const userId = await resolveRequestUserId(req, context);
            const characterId = typeof body?.characterId === "string" ? body.characterId : "";
            const character = await store.getCharacterById({ userId, characterId });
            if (!character || character.status === "archived") {
                throw new AppHttpError(404, "character.not_found", `Character not found: ${characterId}`);
            }
            await context.stores.userPreferences.setCurrentCharacter({
                userId,
                characterId,
                updatedAt: new Date().toISOString(),
            });
            const [state, convList] = await Promise.all([
                context.stores.chat.getCharacterState({ userId, characterId }),
                context.stores.conversation.listConversations({ userId, characterId }),
            ]);
            return {
                character: toContractCharacter(character),
                conversations: convList.map(toContractConversation),
                activeConversationId: state?.currentConversationId ?? null,
            };
        },
        handleError: (error) => ({ status: getAppErrorStatusCode(error, 404), body: toErrorResponse(error) }),
    });

    registerApi(context.app, ApiListCharacterInteractionModes, {
        handleRequest: async () => ({ interactionModes: [...INTERACTION_MODES] }),
    });

    registerApi(context.app, ApiListCharacterTemplates, {
        handleRequest: async (_req, query: ListCharacterTemplatesRequest) => {
            return { templates: listCharacterTemplates(query?.language) };
        },
    });

}
