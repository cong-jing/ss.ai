import type { ConversationActor } from "../stores/character/conversationActor.js";

export type ActorSpeakerTag = {
    actorId: string;
    index: number;
    displayName: string;
    speakerTag: string;
};

type BuildActorSpeakerTagsOptions = {
    displayNameOverridesByActorId?: Map<string, string>;
};

function roleOrder(actor: ConversationActor): number {
    if (actor.role === "self") return 0;
    if (actor.role === "system") return 1;
    return 2;
}

function normalizeDisplayName(name: string): string {
    const cleaned = name.trim().replace(/\[/g, "(").replace(/\]/g, ")");
    return cleaned || "unknown";
}

function sortActorsForSpeakerTag(actors: ConversationActor[]): ConversationActor[] {
    return [...actors].sort((a, b) => {
        const orderDiff = roleOrder(a) - roleOrder(b);
        if (orderDiff !== 0) return orderDiff;

        const createdDiff = a.createdAt.localeCompare(b.createdAt);
        if (createdDiff !== 0) return createdDiff;

        return a.id.localeCompare(b.id);
    });
}

export function buildActorSpeakerTags(
    actors: ConversationActor[] | null | undefined,
    options?: BuildActorSpeakerTagsOptions,
): {
    speakerTags: ActorSpeakerTag[];
    speakerTagByActorId: Map<string, ActorSpeakerTag>;
} {
    if (!actors || actors.length === 0) {
        return { speakerTags: [], speakerTagByActorId: new Map() };
    }

    const sorted = sortActorsForSpeakerTag(actors);
    const speakerTags = sorted.map((actor, index): ActorSpeakerTag => {
        const overriddenDisplayName = options?.displayNameOverridesByActorId?.get(actor.id)?.trim();
        const displayName = normalizeDisplayName(overriddenDisplayName || actor.displayName);
        const tagIndex = index + 1;
        return {
            actorId: actor.id,
            index: tagIndex,
            displayName,
            speakerTag: `p${tagIndex}[${displayName}]`,
        };
    });

    const speakerTagByActorId = new Map<string, ActorSpeakerTag>(speakerTags.map(item => [item.actorId, item]));
    return { speakerTags, speakerTagByActorId };
}
