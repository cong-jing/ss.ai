import type { Character, UserProfile } from "../../../index.js";
import type {
    ConversationActor,
    ConversationActorSourceType,
} from "../../../stores/character/conversationActor.js";
import { buildActorSpeakerTags } from "../../speakerTag.js";

type PromptLoopActorSourceType = Extract<ConversationActorSourceType, "logged_user" | "local_actor">;

export type PromptViewModel = {
    p1: {
        speakerTag: string;
        displayName: string;
        description: string;
        personaPrompt: string;
    };
    p2: {
        speakerTag: "p2[system]";
    };
    actors: Array<{
        speakerTag: string;
        displayName: string;
        sourceType: PromptLoopActorSourceType;
        profile: string;
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

function normalizeActorProfile(
    actor: ConversationActor,
    snapshot: Record<string, unknown> | null,
    userProfile: UserProfile | null,
): string {
    const info = extractActorInfo(actor, snapshot, userProfile).trim();
    return info || "（无）";
}

export function buildPromptViewModel(input: BuildPromptViewModelInput): PromptViewModel {
    const actorList = input.actors ?? [];
    const selfActor = actorList.find(actor => actor.role === "self") ?? null;

    const preferredSelfName = input.character?.displayName || input.character?.name;
    const aliasOverrides = new Map<string, string>();
    if (selfActor && preferredSelfName) {
        aliasOverrides.set(selfActor.id, preferredSelfName);
    }

    const { speakerTags, speakerTagByActorId } = buildActorSpeakerTags(actorList, {
        displayNameOverridesByActorId: aliasOverrides,
    });
    const actorById = new Map<string, ConversationActor>(actorList.map(actor => [actor.id, actor]));

    const actors = speakerTags.map(item => {
        const actor = actorById.get(item.actorId);
        if (!actor) {
            return null;
        }

        if (actor.role !== "other") {
            return null;
        }

        if (actor.sourceType !== "logged_user" && actor.sourceType !== "local_actor") {
            return null;
        }

        const sourceType: PromptLoopActorSourceType = actor.sourceType;
        const snapshot = parseProfileSnapshot(actor.profileSnapshotJson);
        const actorDisplayName = actor.displayName?.trim() || item.displayName || item.speakerTag;

        return {
            speakerTag: item.speakerTag,
            displayName: actorDisplayName,
            sourceType,
            profile: normalizeActorProfile(actor, snapshot, input.userProfile),
        };
    }).filter((actor): actor is PromptViewModel["actors"][number] => actor !== null);

    const selfSpeakerTag = selfActor
        ? (speakerTagByActorId.get(selfActor.id)?.speakerTag ?? "")
        : "";
    const selfDisplayName = (input.character?.displayName || input.character?.name || selfSpeakerTag || "").trim();

    return {
        p1: {
            speakerTag: selfSpeakerTag,
            displayName: selfDisplayName,
            description: input.character?.description ?? "",
            personaPrompt: input.character?.personaPrompt ?? "",
        },
        p2: {
            speakerTag: "p2[system]",
        },
        actors,
        relationshipState: input.relationshipState ?? "",
        memories: input.memories ?? [],
        structuredOutput: input.structuredOutput ?? false,
    };
}
