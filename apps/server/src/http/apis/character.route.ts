import {
    ApiListCharacters,
    ApiCreateCharacter,
    ApiGetCharacter,
    ApiUpdateCharacter,
    ApiDeleteCharacter,
    ApiGetActiveCharacter,
    ApiSetActiveCharacter,
    type CreateCharacterRequest,
    type UpdateCharacterRequest,
    type ListCharactersResponse,
    type Character as ContractCharacter,
} from "@ss-ai/contracts";
import type { Character as PFCharacter } from "@ss-ai/persona-flow";
import { registerApi } from "../registerApi.js";
import { toErrorResponse, DEFAULT_USER_ID, type HttpApiContext } from "./apiContext.js";

// ── Projection ─────────────────────────────────────────────────────────────────

function toContractCharacter(c: PFCharacter): ContractCharacter {
    return {
        id: c.id,
        name: c.name,
        description: c.description ?? "",
        personaPrompt: c.personaPrompt,
        greetingMessage: c.greetingMessage ?? null,
        status: c.status,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
    };
}

const ITEM_URL = ApiGetCharacter.apiUrl; // "/v1/characters/:id"

export function registerCharacterRoutes(context: HttpApiContext): void {
    const store = context.characterStore;
    // GET /v1/characters
    registerApi(context.app, ApiListCharacters, {
        handleRequest: async (): Promise<ListCharactersResponse> => {
            const list = await store.listCharacters({ userId: DEFAULT_USER_ID, status: "active" });
            const prefs = await context.userPreferencesStore.getUserPreferences(DEFAULT_USER_ID);
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
                description: typeof body.description === "string" ? body.description.trim() || null : null,
                personaPrompt: typeof body.personaPrompt === "string" ? body.personaPrompt.trim() : "",
                greetingMessage: typeof body.greetingMessage === "string" ? body.greetingMessage.trim() || null : null,
                displayName: null,
                avatarUrl: null,
                modelConfig: {},
                generationConfig: {},
                memoryConfig: {},
                status: "active",
                createdAt: now,
                updatedAt: now,
            };
            await store.createCharacter(character);

            // Auto-create per-character conversation state
            const conversationId = crypto.randomUUID();
            await context.userCharacterStateStore.upsertState({
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
    context.app.get(ITEM_URL, async (req, res) => {
        const character = await store.getCharacterById({ userId: DEFAULT_USER_ID, characterId: req.params.id });
        if (!character) {
            res.status(404).json(toErrorResponse(new Error(`Character not found: ${req.params.id}`)));
            return;
        }
        res.json(toContractCharacter(character));
    });

    // PATCH /v1/characters/:id
    context.app.patch(ITEM_URL, async (req, res) => {
        const body = req.body as UpdateCharacterRequest;
        const existing = await store.getCharacterById({ userId: DEFAULT_USER_ID, characterId: req.params.id });
        if (!existing || existing.status === "archived") {
            res.status(404).json(toErrorResponse(new Error(`Character not found: ${req.params.id}`)));
            return;
        }
        const patch: Partial<Omit<PFCharacter, "id" | "userId" | "createdAt">> = {
            updatedAt: new Date().toISOString(),
        };
        if (typeof body?.name === "string") patch.name = body.name.trim();
        if (typeof body?.description === "string") patch.description = body.description.trim() || null;
        if (typeof body?.personaPrompt === "string") patch.personaPrompt = body.personaPrompt.trim();
        if (Object.prototype.hasOwnProperty.call(body, "greetingMessage")) {
            patch.greetingMessage = typeof body.greetingMessage === "string"
                ? body.greetingMessage.trim() || null
                : null;
        }
        await store.updateCharacter({ userId: DEFAULT_USER_ID, characterId: req.params.id, patch });
        const updated = await store.getCharacterById({ userId: DEFAULT_USER_ID, characterId: req.params.id });
        res.json(toContractCharacter(updated!));
    });

    // DELETE /v1/characters/:id
    context.app.delete(ITEM_URL, async (req, res) => {
        const existing = await store.getCharacterById({ userId: DEFAULT_USER_ID, characterId: req.params.id });
        if (!existing || existing.status === "archived") {
            res.status(404).json(toErrorResponse(new Error(`Character not found: ${req.params.id}`)));
            return;
        }
        await store.archiveCharacter({ userId: DEFAULT_USER_ID, characterId: req.params.id, updatedAt: new Date().toISOString() });
        res.status(204).send();
    });

    // ── Active character ────────────────────────────────────────────────────────

    registerApi(context.app, ApiGetActiveCharacter, {
        handleRequest: async () => {
            const prefs = await context.userPreferencesStore.getUserPreferences(DEFAULT_USER_ID);
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
            await context.userPreferencesStore.setCurrentCharacter({
                userId: DEFAULT_USER_ID,
                characterId,
                updatedAt: new Date().toISOString(),
            });
            return toContractCharacter(character);
        },
        handleError: (error) => ({ status: 404, body: toErrorResponse(error) }),
    });

    context.logger.debug("character routes registered", { base: ApiListCharacters.apiUrl });
}
