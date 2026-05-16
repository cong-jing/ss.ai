import {
    ApiListCharacters,
    ApiCreateCharacter,
    ApiGetCharacter,
    ApiUpdateCharacter,
    ApiDeleteCharacter,
    ApiGetActiveCharacter,
    ApiSetActiveCharacter,
    ApiListCharacterPromptModes,
    DEFAULT_PROMPT_MODE,
    PROMPT_MODES,
    type CreateCharacterRequest,
    type UpdateCharacterRequest,
    type ListCharactersResponse,
    type Character as ContractCharacter,
    type ConversationInfo,
    type PromptMode as ContractPromptMode,
} from "@ss-ai/contracts";
import type { Character as PFCharacter, Conversation } from "@ss-ai/persona-flow";
import { registerApi } from "../registerApi.js";
import { toErrorResponse, DEFAULT_USER_ID, type HttpApiContext } from "./apiContext.js";

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
        promptMode: c.promptMode ?? DEFAULT_PROMPT_MODE,
        status: c.status,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
    };
}

function normalizePromptMode(value: unknown): ContractPromptMode | undefined {
    if (typeof value !== "string") return undefined;
    return (PROMPT_MODES as readonly string[]).includes(value) ? value as ContractPromptMode : undefined;
}

function toContractConversation(c: Conversation): ConversationInfo {
    return { id: c.id, title: c.title, createdAt: c.createdAt, updatedAt: c.updatedAt };
}

export function registerCharacterRoutes(context: HttpApiContext): void {
    const store = context.stores.character;
    // GET /v1/characters
    registerApi(context.app, ApiListCharacters, {
        handleRequest: async (): Promise<ListCharactersResponse> => {
            const list = await store.listCharacters({ userId: DEFAULT_USER_ID, status: "active" });
            const prefs = await context.stores.userPreferences.getUserPreferences(DEFAULT_USER_ID);
            return {
                characters: list.map(toContractCharacter),
                activeCharacterId: prefs?.currentCharacterId ?? null,
            };
        },
    });

    // POST /v1/characters
    registerApi(context.app, ApiCreateCharacter, {
        handleRequest: async (_, body: CreateCharacterRequest) => {
            const name = typeof body?.name === "string" ? body.name.trim() : "";
            if (!name) throw new Error("name is required");
            const now = new Date().toISOString();
            const character: PFCharacter = {
                id: crypto.randomUUID(),
                userId: DEFAULT_USER_ID,
                name,
                displayName: typeof body.displayName === "string" ? body.displayName.trim() || null : null,
                description: typeof body.description === "string" ? body.description.trim() || null : null,
                personaPrompt: typeof body.personaPrompt === "string" ? body.personaPrompt.trim() : "",
                greetingMessage: typeof body.greetingMessage === "string" ? body.greetingMessage.trim() || null : null,
                avatarUrl: null,
                modelConfig: {},
                promptMode: normalizePromptMode(body.promptMode) ?? DEFAULT_PROMPT_MODE,
                generationConfig: {},
                memoryConfig: {},
                status: "active",
                createdAt: now,
                updatedAt: now,
            };
            await store.createCharacter(character);

            // Auto-create per-character conversation state + first conversation record
            const conversationId = crypto.randomUUID();
            await context.stores.conversation.createConversation({
                id: conversationId,
                userId: DEFAULT_USER_ID,
                characterId: character.id,
                title: "new chat",
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
                characterId: character.id,
                currentConversationId: conversationId,
                createdAt: now,
                updatedAt: now,
            });

            return toContractCharacter(character);
        },
        handleError: (error) => ({ status: 400, body: toErrorResponse(error) }),
    });

    // GET /v1/characters/:id
    registerApi(context.app, ApiGetCharacter, {
        handleRequest: async (req) => {
            const character = await store.getCharacterById({ userId: DEFAULT_USER_ID, characterId: req.params.id });
            if (!character) throw new Error(`Character not found: ${req.params.id}`);
            return toContractCharacter(character);
        },
        handleError: (error) => ({ status: 404, body: toErrorResponse(error) }),
    });

    // PATCH /v1/characters/:id
    registerApi(context.app, ApiUpdateCharacter, {
        handleRequest: async (req, body: UpdateCharacterRequest) => {
            const existing = await store.getCharacterById({ userId: DEFAULT_USER_ID, characterId: req.params.id });
            if (!existing || existing.status === "archived") {
                throw new Error(`Character not found: ${req.params.id}`);
            }
            const patch: Partial<Omit<PFCharacter, "id" | "userId" | "createdAt">> = {
                updatedAt: new Date().toISOString(),
            };
            if (typeof body?.name === "string") patch.name = body.name.trim();
            if (Object.prototype.hasOwnProperty.call(body, "displayName")) {
                patch.displayName = typeof body.displayName === "string" ? body.displayName.trim() || null : null;
            }
            if (typeof body?.description === "string") patch.description = body.description.trim() || null;
            if (typeof body?.personaPrompt === "string") patch.personaPrompt = body.personaPrompt.trim();
            if (Object.prototype.hasOwnProperty.call(body, "greetingMessage")) {
                patch.greetingMessage = typeof body.greetingMessage === "string"
                    ? body.greetingMessage.trim() || null
                    : null;
            }
            if (Object.prototype.hasOwnProperty.call(body, "promptMode")) {
                patch.promptMode = normalizePromptMode(body.promptMode) ?? DEFAULT_PROMPT_MODE;
            }
            if (Object.prototype.hasOwnProperty.call(body, "modelConfig")
                && body.modelConfig !== null && typeof body.modelConfig === "object") {
                patch.modelConfig = body.modelConfig as Record<string, unknown>;
            }
            await store.updateCharacter({ userId: DEFAULT_USER_ID, characterId: req.params.id, patch });
            const updated = await store.getCharacterById({ userId: DEFAULT_USER_ID, characterId: req.params.id });
            return toContractCharacter(updated!);
        },
        handleError: (error) => ({ status: 404, body: toErrorResponse(error) }),
    });

    // DELETE /v1/characters/:id
    registerApi(context.app, ApiDeleteCharacter, {
        handleRequest: async (req) => {
            const existing = await store.getCharacterById({ userId: DEFAULT_USER_ID, characterId: req.params.id });
            if (!existing || existing.status === "archived") {
                throw new Error(`Character not found: ${req.params.id}`);
            }
            await store.archiveCharacter({ userId: DEFAULT_USER_ID, characterId: req.params.id, updatedAt: new Date().toISOString() });
        },
        handleError: (error) => ({ status: 404, body: toErrorResponse(error) }),
    });

    // ── Active character ────────────────────────────────────────────────────────

    registerApi(context.app, ApiGetActiveCharacter, {
        handleRequest: async () => {
            const prefs = await context.stores.userPreferences.getUserPreferences(DEFAULT_USER_ID);
            return { characterId: prefs?.currentCharacterId ?? null };
        },
    });

    registerApi(context.app, ApiSetActiveCharacter, {
        handleRequest: async (_, body) => {
            const characterId = typeof body?.characterId === "string" ? body.characterId : "";
            const character = await store.getCharacterById({ userId: DEFAULT_USER_ID, characterId });
            if (!character || character.status === "archived") {
                throw new Error(`Character not found: ${characterId}`);
            }
            await context.stores.userPreferences.setCurrentCharacter({
                userId: DEFAULT_USER_ID,
                characterId,
                updatedAt: new Date().toISOString(),
            });
            const [state, convList] = await Promise.all([
                context.stores.chat.getCharacterState({ userId: DEFAULT_USER_ID, characterId }),
                context.stores.conversation.listConversations({ userId: DEFAULT_USER_ID, characterId }),
            ]);
            return {
                character: toContractCharacter(character),
                conversations: convList.map(toContractConversation),
                activeConversationId: state?.currentConversationId ?? null,
            };
        },
        handleError: (error) => ({ status: 404, body: toErrorResponse(error) }),
    });

    registerApi(context.app, ApiListCharacterPromptModes, {
        handleRequest: async () => ({ promptModes: [...PROMPT_MODES] }),
    });

}
