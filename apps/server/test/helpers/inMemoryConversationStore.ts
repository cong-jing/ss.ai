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

    async createConversation(conversation: Conversation): Promise<void> {
        this.conversationsById.set(conversation.id, conversation);
    }

    async deleteConversation(input: { userId: string; conversationId: string }): Promise<void> {
        this.conversationsById.delete(input.conversationId);
    }
}
