import type { UserCharacterState } from "./userCharacterState.js";

export interface UserCharacterStateStore {
    getState(input: { userId: string; characterId: string }): Promise<UserCharacterState | null>;
    upsertState(state: UserCharacterState): Promise<void>;
}
