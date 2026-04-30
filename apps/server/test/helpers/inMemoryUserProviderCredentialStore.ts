import type { UserProviderCredential, UserProviderCredentialStore } from "@ss-ai/persona-flow";

export class InMemoryUserProviderCredentialStore implements UserProviderCredentialStore {
    private readonly store = new Map<string, UserProviderCredential>();

    private key(userId: string, provider: string): string {
        return `${userId}:${provider}`;
    }

    async getCredential(input: { userId: string; provider: string }): Promise<UserProviderCredential | null> {
        return this.store.get(this.key(input.userId, input.provider)) ?? null;
    }

    async upsertCredential(credential: UserProviderCredential): Promise<void> {
        this.store.set(this.key(credential.userId, credential.provider), { ...credential });
    }

    async deleteCredential(input: { userId: string; provider: string }): Promise<void> {
        this.store.delete(this.key(input.userId, input.provider));
    }

    async listCredentials(userId: string): Promise<UserProviderCredential[]> {
        return [...this.store.values()].filter(c => c.userId === userId);
    }
}
