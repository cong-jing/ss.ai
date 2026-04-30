import {
    ApiGetCharacterInfo,
    ApiUpsertCharacterInfo,
    ApiGetActiveCharacter,
    ApiSetActiveCharacter,
    type Character as ContractCharacter,
} from "@ss-ai/contracts";
import type { Character as PFCharacter, CharacterStore } from "@ss-ai/persona-flow";
import { registerApi } from "../registerApi.js";
import { toErrorResponse, type HttpApiContext } from "./apiContext.js";
import type { JsonFileStore } from "../jsonFileStore.js";

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

/**
 * Persisted character-info data.
 *
 * - `name`, `description` — legacy single-character identity fields.
 * - `activeConversationId` — the current long-running conversation (single-user stage).
 *
 * Note: `activeCharacterId` has been moved to UserSettings so it persists
 * alongside other user preferences.
 */
export interface CharacterInfoData {
    name: string;
    description: string;
    /** The currently active conversationId for this character (single-user stage). */
    activeConversationId?: string;
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

    // GET /v1/active-character — reads from userSettingsStore
    registerApi(context.app, ApiGetActiveCharacter, {
        handleRequest: () => {
            const { activeCharacterId } = context.userSettingsStore.read();
            return { characterId: activeCharacterId ?? null };
        }
    });

    // POST /v1/active-character — validates character exists, persists in userSettingsStore
    registerApi(context.app, ApiSetActiveCharacter, {
        handleRequest: async (_, body) => {
            const characterId = typeof body?.characterId === "string" ? body.characterId : "";
            const character = await characterStore.getCharacterById(characterId);
            if (!character) {
                throw new Error(`Character not found: ${characterId}`);
            }
            context.userSettingsStore.update({ activeCharacterId: characterId });
            return toContractCharacter(character);
        },
        handleError: (error) => {
            const response = toErrorResponse(error);
            return { status: 404, body: response };
        }
    });
}
