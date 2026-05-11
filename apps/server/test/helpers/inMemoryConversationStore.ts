import type { ConversationStore, Conversation } from "@ss-ai/persona-flow";

export class InMemoryConversationStore implements ConversationStore {
    private readonly conversationsById = new Map<string, Conversation>();

    async listConversations(input: { userId: string; characterId: string }): Promise<Conversation[]> {
        return Array.from(this.conversationsById.values())
            .filter(c => c.userId === input.userId && c.characterId === input.characterId)
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }

    async getConversationById(input: { userId: string; conversationId: string }): Promise<Conversation | null> {
        const c = this.conversationsById.get(input.conversationId);
        if (!c || c.userId !== input.userId) return null;
        return c;
    }

    async createConversation(
        conversation: Conversation,
        _options: { selfDisplayName: string },
    ): Promise<{ selfActorId: string; systemActorId: string }> {
        this.conversationsById.set(conversation.id, conversation);
        return { selfActorId: crypto.randomUUID(), systemActorId: crypto.randomUUID() };
    }

    async deleteConversation(input: { userId: string; conversationId: string }): Promise<void> {
        this.conversationsById.delete(input.conversationId);
    }

    async updateConversationTitle(input: {
        userId: string;
        conversationId: string;
        title: string | null;
        updatedAt: string;
    }): Promise<void> {
        const existing = this.conversationsById.get(input.conversationId);
        if (!existing || existing.userId !== input.userId) return;
        this.conversationsById.set(input.conversationId, {
            ...existing,
            title: input.title,
            updatedAt: input.updatedAt,
        });
    }
}
