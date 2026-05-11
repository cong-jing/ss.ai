import type { ConversationActor } from "../stores/character/conversationActor.js";

export type ActorAlias = {
    actorId: string;
    index: number;
    displayName: string;
    token: string;
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

function sortActorsForAlias(actors: ConversationActor[]): ConversationActor[] {
    return [...actors].sort((a, b) => {
        const orderDiff = roleOrder(a) - roleOrder(b);
        if (orderDiff !== 0) return orderDiff;

        const createdDiff = a.createdAt.localeCompare(b.createdAt);
        if (createdDiff !== 0) return createdDiff;

        return a.id.localeCompare(b.id);
    });
}

export function buildActorAliases(actors: ConversationActor[] | null | undefined): {
    aliases: ActorAlias[];
    aliasByActorId: Map<string, ActorAlias>;
} {
    if (!actors || actors.length === 0) {
        return { aliases: [], aliasByActorId: new Map() };
    }

    const sorted = sortActorsForAlias(actors);
    const aliases = sorted.map((actor, index): ActorAlias => {
        const displayName = normalizeDisplayName(actor.displayName);
        const aliasIndex = index + 1;
        return {
            actorId: actor.id,
            index: aliasIndex,
            displayName,
            token: `p${aliasIndex}[${displayName}]`,
        };
    });

    const aliasByActorId = new Map<string, ActorAlias>(aliases.map(alias => [alias.actorId, alias]));
    return { aliases, aliasByActorId };
}
