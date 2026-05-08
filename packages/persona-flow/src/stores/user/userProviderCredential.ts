export type UserProviderCredential = {
    userId: string;
    provider: string;
    /** Field name retained for when encryption is added later. Currently stores plaintext. */
    apiKeyEncrypted: string;
    createdAt: string;
    updatedAt: string;
};
