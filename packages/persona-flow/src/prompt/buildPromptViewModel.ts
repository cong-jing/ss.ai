import type { Character, UserProfile } from "../index.js";
import type { ConversationActor } from "../stores/character/conversationActor.js";
import { buildActorAliases } from "./actorAlias.js";

export type PromptViewModel = {
    self: {
        alias: string;
        displayName: string;
    };
    actors: Array<{
        alias: string;
        role: string;
        sourceType: string;
        info: string;
        isSelf: boolean;
        displayName: string;
        description: string;
        personaPrompt: string;
    }>;
    relationshipState: string;
    memories: string[];
    structuredOutput: boolean;
};

export interface BuildPromptViewModelInput {
    character: Character | null;
    userProfile: UserProfile | null;
    actors?: ConversationActor[] | null;
    relationshipState?: string | null;
    memories?: string[] | null;
    structuredOutput?: boolean;
}

function parseProfileSnapshot(profileSnapshotJson: string | null): Record<string, unknown> | null {
    if (!profileSnapshotJson) return null;
    try {
        const parsed = JSON.parse(profileSnapshotJson);
        if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
            return parsed as Record<string, unknown>;
        }
    } catch {
        // Ignore malformed snapshot JSON and fall back to other sources.
    }
    return null;
}

function stringifySnapshotValue(value: unknown): string {
    if (value === undefined || value === null || value === "") return "";
    if (Array.isArray(value)) return value.map(item => String(item)).join("，");
    if (typeof value === "object") return JSON.stringify(value);
    return String(value);
}

function extractLoggedUserInfo(
    actor: ConversationActor,
    snapshot: Record<string, unknown> | null,
    userProfile: UserProfile | null,
): string {
    const keys = ["bio", "description", "background"];
    for (const key of keys) {
        const text = stringifySnapshotValue(snapshot?.[key]).trim();
        if (text) return text;
    }

    if (
        actor.userProfileId
        && userProfile
        && userProfile.userId === actor.userProfileId
        && userProfile.bio.trim()
    ) {
        return userProfile.bio.trim();
    }

    return "";
}

function extractActorInfo(
    actor: ConversationActor,
    snapshot: Record<string, unknown> | null,
    userProfile: UserProfile | null,
): string {
    if (actor.sourceType === "logged_user") {
        return extractLoggedUserInfo(actor, snapshot, userProfile);
    }

    const keys = ["description", "background", "bio"];
    for (const key of keys) {
        const text = stringifySnapshotValue(snapshot?.[key]).trim();
        if (text) return text;
    }

    return "";
}

export function buildPromptViewModel(input: BuildPromptViewModelInput): PromptViewModel {
    const actorList = input.actors ?? [];
    const selfActor = actorList.find(actor => actor.role === "self") ?? null;

    const preferredSelfName = input.character?.displayName || input.character?.name;
    const aliasOverrides = new Map<string, string>();
    if (selfActor && preferredSelfName) {
        aliasOverrides.set(selfActor.id, preferredSelfName);
    }

    const { aliases, aliasByActorId } = buildActorAliases(actorList, {
        displayNameOverridesByActorId: aliasOverrides,
    });
    const actorById = new Map<string, ConversationActor>(actorList.map(actor => [actor.id, actor]));

    const actors = aliases.map(alias => {
        const actor = actorById.get(alias.actorId);
        if (!actor) {
            return {
                alias: alias.token,
                role: "other",
                sourceType: "local_actor",
                info: "",
                isSelf: false,
                displayName: alias.displayName || alias.token,
                description: "",
                personaPrompt: "",
            };
        }

        const snapshot = parseProfileSnapshot(actor.profileSnapshotJson);
        const info = extractActorInfo(actor, snapshot, input.userProfile);
        const isSelf = actor.role === "self";
        const actorDisplayName = actor.displayName?.trim() || alias.displayName || alias.token;

        return {
            alias: alias.token,
            role: actor.role,
            sourceType: actor.sourceType,
            info,
            isSelf,
            displayName: actorDisplayName,
            description: isSelf ? (input.character?.description ?? "") : "",
            personaPrompt: isSelf ? (input.character?.personaPrompt ?? "") : "",
        };
    });

    const selfAlias = selfActor
        ? (aliasByActorId.get(selfActor.id)?.token ?? "")
        : "";
    const selfDisplayName = (input.character?.displayName || input.character?.name || selfAlias || "").trim();

    return {
        self: {
            alias: selfAlias,
            displayName: selfDisplayName,
        },
        actors,
        relationshipState: input.relationshipState ?? "",
        memories: input.memories ?? [],
        structuredOutput: input.structuredOutput ?? false,
    };
}
