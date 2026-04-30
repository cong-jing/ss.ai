import type { UserProviderCredential } from "./userProviderCredential.js";

export interface UserProviderCredentialStore {
    getCredential(input: { userId: string; provider: string }): Promise<UserProviderCredential | null>;
    upsertCredential(credential: UserProviderCredential): Promise<void>;
    deleteCredential(input: { userId: string; provider: string }): Promise<void>;
    listCredentials(userId: string): Promise<UserProviderCredential[]>;
}
