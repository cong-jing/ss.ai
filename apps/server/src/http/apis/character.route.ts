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
import type { Character as PFCharacter, CharacterStore } from "@ss-ai/persona-flow";
import { registerApi } from "../registerApi.js";
import { toErrorResponse, type HttpApiContext } from "./apiContext.js";

// ── Projection ─────────────────────────────────────────────────────────────────
// Maps a persona-flow Character (rich domain model) to the HTTP API shape.
// displayName, avatarUrl, and *Config blobs are intentionally excluded.

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

export function registerCharacterRoutes(context: HttpApiContext, store: CharacterStore): void {
    // GET /v1/characters — list active characters + current active character id
    registerApi(context.app, ApiListCharacters, {
        handleRequest: async (): Promise<ListCharactersResponse> => {
            const list = await store.listCharacters({ status: "active" });
            const { activeCharacterId } = context.userSettingsStore.read();
            return {
                characters: list.map(toContractCharacter),
                activeCharacterId: activeCharacterId ?? null,
            };
        },
    });

    // POST /v1/characters — create
    registerApi(context.app, ApiCreateCharacter, {
        handleRequest: async (_, body: CreateCharacterRequest) => {
            const name = typeof body?.name === "string" ? body.name.trim() : "";
            if (!name) throw new Error("name is required");
            const now = new Date().toISOString();
            const character: PFCharacter = {
                id: crypto.randomUUID(),
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
            return toContractCharacter(character);
        },
        handleError: (error) => ({ status: 400, body: toErrorResponse(error) }),
    });

    // GET /v1/characters/:id — get one
    context.app.get(ITEM_URL, async (req, res) => {
        const character = await store.getCharacterById(req.params.id);
        if (!character) {
            res.status(404).json(toErrorResponse(new Error(`Character not found: ${req.params.id}`)));
            return;
        }
        res.json(toContractCharacter(character));
    });

    // PATCH /v1/characters/:id — partial update
    context.app.patch(ITEM_URL, async (req, res) => {
        const body = req.body as UpdateCharacterRequest;
        const existing = await store.getCharacterById(req.params.id);
        if (!existing || existing.status === "archived") {
            res.status(404).json(toErrorResponse(new Error(`Character not found: ${req.params.id}`)));
            return;
        }
        const patch: Partial<Omit<PFCharacter, "id" | "createdAt">> = {
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
        await store.updateCharacter({ id: req.params.id, patch });
        const updated = await store.getCharacterById(req.params.id);
        res.json(toContractCharacter(updated!));
    });

    // DELETE /v1/characters/:id — soft-delete (archive)
    context.app.delete(ITEM_URL, async (req, res) => {
        const existing = await store.getCharacterById(req.params.id);
        if (!existing || existing.status === "archived") {
            res.status(404).json(toErrorResponse(new Error(`Character not found: ${req.params.id}`)));
            return;
        }
        await store.archiveCharacter({ id: req.params.id, updatedAt: new Date().toISOString() });
        res.status(204).send();
    });

    // ── Active character ────────────────────────────────────────────────────────

    // GET /v1/active-character — reads from userSettingsStore
    registerApi(context.app, ApiGetActiveCharacter, {
        handleRequest: () => {
            const { activeCharacterId } = context.userSettingsStore.read();
            return { characterId: activeCharacterId ?? null };
        },
    });

    // POST /v1/active-character — validates character exists, persists in userSettingsStore
    registerApi(context.app, ApiSetActiveCharacter, {
        handleRequest: async (_, body) => {
            const characterId = typeof body?.characterId === "string" ? body.characterId : "";
            const character = await store.getCharacterById(characterId);
            if (!character || character.status === "archived") {
                throw new Error(`Character not found: ${characterId}`);
            }
            context.userSettingsStore.update({ activeCharacterId: characterId });
            return toContractCharacter(character);
        },
        handleError: (error) => ({ status: 404, body: toErrorResponse(error) }),
    });

    context.logger.debug("character routes registered", { base: ApiListCharacters.apiUrl });
}
