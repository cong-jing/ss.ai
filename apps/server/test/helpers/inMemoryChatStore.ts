import type { ChatStore, Message, UserCharacterState } from "@ss-ai/persona-flow";

export class InMemoryChatStore implements ChatStore {
    private readonly messages = new Map<string, Message[]>();
    private readonly characterStates = new Map<string, UserCharacterState>();

    private messageKey(userId: string, conversationId: string): string {
        return `${userId}::${conversationId}`;
    }

    private stateKey(userId: string, characterId: string): string {
        return `${userId}::${characterId}`;
    }

    async appendMessage(message: Message): Promise<void> {
        const key = this.messageKey(message.userId, message.conversationId);
        const existing = this.messages.get(key) ?? [];
        this.messages.set(key, [...existing, message]);
    }

    async getRecentMessages(input: {
        userId: string;
        conversationId: string;
        limit: number;
    }): Promise<Message[]> {
        const key = this.messageKey(input.userId, input.conversationId);
        const all = this.messages.get(key) ?? [];
        return all.slice(-input.limit);
    }

    async getCharacterState(input: {
        userId: string;
        characterId: string;
    }): Promise<UserCharacterState | null> {
        const key = this.stateKey(input.userId, input.characterId);
        return this.characterStates.get(key) ?? null;
    }

    async upsertCharacterState(state: UserCharacterState): Promise<void> {
        const key = this.stateKey(state.userId, state.characterId);
        this.characterStates.set(key, state);
    }
}
