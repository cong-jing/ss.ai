import {
    ApiListCharacters,
    ApiCreateCharacter,
    ApiGetCharacter,
    ApiUpdateCharacter,
    ApiDeleteCharacter,
    type CreateCharacterRequest,
    type UpdateCharacterRequest,
} from "@ss-ai/contracts";
import { registerApi } from "../registerApi.js";
import { toErrorResponse, type HttpApiContext } from "./apiContext.js";
import type { CharacterStore } from "../characterStore.js";

// URL base pattern — derive from the contract so there's one source of truth.
// "/v1/characters/:id" → "/v1/characters"
const BASE_URL = ApiListCharacters.apiUrl; // "/v1/characters"
const ITEM_URL = ApiGetCharacter.apiUrl;    // "/v1/characters/:id"

export function registerCharacterRoutes(context: HttpApiContext, store: CharacterStore): void {
    // GET /v1/characters — list
    registerApi(context.app, ApiListCharacters, {
        handleRequest: () => store.list(),
    });

    // POST /v1/characters — create
    registerApi(context.app, ApiCreateCharacter, {
        handleRequest: (_, body: CreateCharacterRequest) => {
            const name = typeof body?.name === "string" ? body.name.trim() : "";
            if (!name) throw new Error("name is required");
            const description = typeof body?.description === "string" ? body.description : "";
            return store.create(name, description);
        },
        handleError: (error) => ({ status: 400, body: toErrorResponse(error) }),
    });

    // GET /v1/characters/:id — get one
    // registerApi does not support path params, so register directly with Express.
    context.app.get(ITEM_URL, (req, res) => {
        const character = store.get(req.params.id);
        if (!character) {
            res.status(404).json(toErrorResponse(new Error(`Character not found: ${req.params.id}`)));
            return;
        }
        res.json(character);
    });

    // PATCH /v1/characters/:id — update
    context.app.patch(ITEM_URL, (req, res) => {
        const body = req.body as UpdateCharacterRequest;
        const updated = store.update(req.params.id, {
            name: body?.name,
            description: body?.description,
        });
        if (!updated) {
            res.status(404).json(toErrorResponse(new Error(`Character not found: ${req.params.id}`)));
            return;
        }
        res.json(updated);
    });

    // DELETE /v1/characters/:id — delete
    context.app.delete(ITEM_URL, (req, res) => {
        const deleted = store.delete(req.params.id);
        if (!deleted) {
            res.status(404).json(toErrorResponse(new Error(`Character not found: ${req.params.id}`)));
            return;
        }
        res.status(204).send();
    });

    context.logger.debug("character routes registered", { base: BASE_URL });
}
