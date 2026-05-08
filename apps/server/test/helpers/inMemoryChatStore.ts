import type { ChatStore, Message, UserCharacterState } from "@ss-ai/persona-flow";

export class InMemoryChatStore implements ChatStore {
    private readonly messagesByConv = new Map<string, Message[]>();
    private readonly characterStates = new Map<string, UserCharacterState>();

    private messageKey(userId: string, conversationId: string): string {
        return `${userId}::${conversationId}`;
    }

    private stateKey(userId: string, characterId: string): string {
        return `${userId}::${characterId}`;
    }

    // ── Messages ──────────────────────────────────────────────────────────────

    async appendMessage(message: Message): Promise<void> {
        const key = this.messageKey(message.userId, message.conversationId);
        const existing = this.messagesByConv.get(key) ?? [];
        this.messagesByConv.set(key, [...existing, message]);
    }

    async getRecentMessages(input: {
        userId: string;
        conversationId: string;
        limit: number;
    }): Promise<Message[]> {
        const key = this.messageKey(input.userId, input.conversationId);
        const all = this.messagesByConv.get(key) ?? [];
        return all.slice(-input.limit);
    }

    // ── Per-character conversation state ──────────────────────────────────────

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
