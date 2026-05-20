export type UserProviderCredential = {
    userId: string;
    provider: string;
    /**
     * Encrypted API key payload.
     * Current design uses this directly as the secret blob (not an indirection id).
     */
    encryptedApiKey: string;
    createdAt: string;
    updatedAt: string;
};
