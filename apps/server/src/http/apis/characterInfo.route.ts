import {
    ApiGetCharacterInfo,
    ApiUpsertCharacterInfo,
    ApiGetActiveCharacter,
    ApiSetActiveCharacter,
} from "@ss-ai/contracts";
import { registerApi } from "../registerApi.js";
import { toErrorResponse, type HttpApiContext } from "./apiContext.js";
import type { JsonFileStore } from "../jsonFileStore.js";
import type { CharacterStore } from "../characterStore.js";

/**
 * Persisted character data.
 *
 * - `name`, `description` — legacy single-character identity fields.
 * - `activeConversationId` — the current long-running conversation (single-user stage).
 * - `activeCharacterId` — which Character from CharacterStore is currently selected.
 *
 * Future: move activeCharacterId + activeConversationId to a userId+characterId state store.
 */
export interface CharacterInfoData {
    name: string;
    description: string;
    /** The currently active conversationId for this character (single-user stage). */
    activeConversationId?: string;
    /** The currently selected characterId from the character list. */
    activeCharacterId?: string;
}

export function registerCharacterInfoRoutes(
    context: HttpApiContext,
    store: JsonFileStore<CharacterInfoData>,
    characterStore: CharacterStore
): void {
    registerApi(context.app, ApiGetCharacterInfo, {
        handleRequest: () => {
            const { name, description } = store.read();
            return { name, description };
        }
    });

    registerApi(context.app, ApiUpsertCharacterInfo, {
        handleRequest: (_, body) => {
            const name = typeof body?.name === "string" ? body.name : "";
            const description = typeof body?.description === "string" ? body.description : "";
            const updated = store.update({ name, description });
            return { name: updated.name, description: updated.description };
        },
        handleError: (error) => {
            const response = toErrorResponse(error);
            return { status: 400, body: response };
        }
    });

    // GET /v1/active-character
    registerApi(context.app, ApiGetActiveCharacter, {
        handleRequest: () => {
            const { activeCharacterId } = store.read();
            return { characterId: activeCharacterId ?? null };
        }
    });

    // POST /v1/active-character
    registerApi(context.app, ApiSetActiveCharacter, {
        handleRequest: (_, body) => {
            const characterId = typeof body?.characterId === "string" ? body.characterId : "";
            const character = characterStore.get(characterId);
            if (!character) {
                throw new Error(`Character not found: ${characterId}`);
            }
            store.update({ activeCharacterId: characterId });
            return character;
        },
        handleError: (error) => {
            const response = toErrorResponse(error);
            return { status: 404, body: response };
        }
    });
}
