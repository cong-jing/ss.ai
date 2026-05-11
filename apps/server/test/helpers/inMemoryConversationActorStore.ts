import type {
    ConversationActorStore,
    ConversationActor,
    AddConversationActorInput,
    UpdateConversationActorInput,
} from "@ss-ai/persona-flow";

export class InMemoryConversationActorStore implements ConversationActorStore {
    private readonly actorsById = new Map<string, ConversationActor>();

    async getActorById(id: string): Promise<ConversationActor | null> {
        return this.actorsById.get(id) ?? null;
    }

    async listConversationActors(input: {
        conversationId: string;
        activeOnly?: boolean;
    }): Promise<ConversationActor[]> {
        return Array.from(this.actorsById.values())
            .filter(p => p.conversationId === input.conversationId)
            .filter(p => (input.activeOnly ? p.leftAt === null : true))
            .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    }

    async addConversationActor(input: AddConversationActorInput): Promise<ConversationActor> {
        const now = new Date().toISOString();
        const actor: ConversationActor = {
            id: crypto.randomUUID(),
            conversationId: input.conversationId,
            role: input.role,
            sourceType: input.sourceType,
            displayName: input.displayName,
            userProfileId: input.userProfileId ?? null,
            characterId: input.characterId ?? null,
            profileSnapshotJson: input.profileSnapshotJson ?? null,
            leftAt: null,
            createdAt: now,
            updatedAt: now,
        };
        this.actorsById.set(actor.id, actor);
        return actor;
    }

    async updateConversationActor(input: UpdateConversationActorInput): Promise<void> {
        const existing = this.actorsById.get(input.id);
        if (!existing) return;

        const updated: ConversationActor = {
            ...existing,
            displayName: input.displayName ?? existing.displayName,
            profileSnapshotJson: input.profileSnapshotJson !== undefined
                ? input.profileSnapshotJson
                : existing.profileSnapshotJson,
            leftAt: input.leftAt !== undefined ? input.leftAt : existing.leftAt,
            updatedAt: new Date().toISOString(),
        };
        this.actorsById.set(input.id, updated);
    }

    async createActor(actor: ConversationActor): Promise<void> {
        this.actorsById.set(actor.id, actor);
    }
}
