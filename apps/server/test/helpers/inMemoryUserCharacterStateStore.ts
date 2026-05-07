import type { UserCharacterState, UserCharacterStateStore } from "@ss-ai/persona-flow";

export class InMemoryUserCharacterStateStore implements UserCharacterStateStore {
    private readonly store = new Map<string, UserCharacterState>();

    private key(userId: string, characterId: string): string {
        return `${userId}::${characterId}`;
    }

    async getState(input: { userId: string; characterId: string }): Promise<UserCharacterState | null> {
        return this.store.get(this.key(input.userId, input.characterId)) ?? null;
    }

    async upsertState(state: UserCharacterState): Promise<void> {
        this.store.set(this.key(state.userId, state.characterId), { ...state });
    }
}
