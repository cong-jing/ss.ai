import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
    AppStores,
    ModelClient,
    ModelEmbedInput,
    ModelEmbedResult,
    UserPreferences,
    UserProviderCredential,
} from "../src/index.js";
import {
    MEMORY_EMBED_PURPOSE,
    ModelClientEmbeddingProvider,
    ModelClientEmbeddingProviderError,
} from "../src/memoryAdapters/modelClientEmbeddingProvider.js";

class FakePreferencesStore {
    constructor(private readonly data: UserPreferences | null) { }
    async getUserPreferences(): Promise<UserPreferences | null> { return this.data; }
    async upsertUserPreferences(): Promise<void> { }
    async setCurrentCharacter(): Promise<void> { }
    async setModelAssignment(): Promise<void> { }
}

class FakeCredentialStore {
    constructor(private readonly credential: UserProviderCredential | null) { }
    async getCredential(): Promise<UserProviderCredential | null> { return this.credential; }
    async upsertCredential(): Promise<void> { }
    async deleteCredential(): Promise<void> { }
    async listCredentials(): Promise<UserProviderCredential[]> { return this.credential ? [this.credential] : []; }
}

function createStores(input: {
    preferences?: UserPreferences | null;
    credential?: UserProviderCredential | null;
} = {}): AppStores {
    return {
        userPreferences: new FakePreferencesStore(input.preferences ?? null),
        providerCredential: new FakeCredentialStore(input.credential ?? null),
    } as unknown as AppStores;
}

interface FakeModelClientOptions {
    embed?: (input: ModelEmbedInput) => Promise<ModelEmbedResult> | ModelEmbedResult;
}

function makeModelClient(options: FakeModelClientOptions = {}): { client: ModelClient; calls: ModelEmbedInput[] } {
    const calls: ModelEmbedInput[] = [];
    const client: ModelClient = {
        generate: async () => { throw new Error("unused"); },
        generateStream: async () => { throw new Error("unused"); },
        listModels: async () => [],
        ...(options.embed
            ? {
                embed: async (input: ModelEmbedInput) => {
                    calls.push(input);
                    return options.embed!(input);
                },
            }
            : {}),
    };
    return { client, calls };
}

describe("ModelClientEmbeddingProvider", () => {
    it("resolves provider/model from defaultModelAssignments and calls modelClient.embed", async () => {
        const { client, calls } = makeModelClient({
            embed: () => ({
                vectors: [[0.1, 0.2, 0.3]],
                model: "mistral-embed",
                usage: { promptTokens: 4, totalTokens: 4 },
            }),
        });
        const provider = new ModelClientEmbeddingProvider({
            modelClient: client,
            appStores: createStores(),
            defaultModelAssignments: {
                "memory.embed": { provider: "mistral.ai", model: "mistral-embed" },
            },
            defaultProviderApiKeys: { "mistral.ai": "default-key" },
        });

        const result = await provider.embed({ text: "hello", purpose: "memory.write.candidate" });

        assert.equal(calls.length, 1);
        assert.equal(calls[0]!.provider, "mistral.ai");
        assert.equal(calls[0]!.model, "mistral-embed");
        assert.equal(calls[0]!.encryptedApiKey, "default-key");
        assert.deepEqual(calls[0]!.inputs, ["hello"]);
        assert.deepEqual(result.embedding.vector, [0.1, 0.2, 0.3]);
        assert.equal(result.embedding.provider, "mistral.ai");
        assert.equal(result.embedding.model, "mistral-embed");
        assert.equal(result.embedding.dim, 3);
        assert.equal(result.embedding.version, 1);
        assert.ok(result.embedding.createdAt.length > 0);
        assert.equal(result.usage?.promptTokens, 4);
    });

    it("prefers per-user assignment + per-user credential over defaults", async () => {
        const now = new Date().toISOString();
        const { client, calls } = makeModelClient({
            embed: () => ({ vectors: [[1]], model: "user-embed" }),
        });
        const provider = new ModelClientEmbeddingProvider({
            modelClient: client,
            appStores: createStores({
                preferences: {
                    userId: "u1",
                    modelAssignments: {
                        "memory.embed": { provider: "custom-provider", model: "user-embed" },
                    },
                    createdAt: now,
                    updatedAt: now,
                } as UserPreferences,
                credential: {
                    userId: "u1",
                    provider: "custom-provider",
                    encryptedApiKey: "user-key",
                    createdAt: now,
                    updatedAt: now,
                },
            }),
            defaultModelAssignments: {
                "memory.embed": { provider: "mistral.ai", model: "mistral-embed" },
            },
            defaultProviderApiKeys: { "mistral.ai": "default-key" },
        });

        await provider.embed({ text: "hi", purpose: "memory.write.candidate", userId: "u1" });

        assert.equal(calls[0]!.provider, "custom-provider");
        assert.equal(calls[0]!.model, "user-embed");
        assert.equal(calls[0]!.encryptedApiKey, "user-key");
    });

    it("falls back to default provider API key when user has no credential", async () => {
        const { client, calls } = makeModelClient({
            embed: () => ({ vectors: [[1]], model: "mistral-embed" }),
        });
        const provider = new ModelClientEmbeddingProvider({
            modelClient: client,
            appStores: createStores(),
            defaultModelAssignments: {
                "memory.embed": { provider: "mistral.ai", model: "mistral-embed" },
            },
            defaultProviderApiKeys: { "mistral.ai": "default-key" },
        });

        await provider.embed({ text: "hi", purpose: "p", userId: "u1" });

        assert.equal(calls[0]!.encryptedApiKey, "default-key");
    });

    it("throws assignment_missing when memory.embed is not configured anywhere", async () => {
        const { client } = makeModelClient({ embed: () => ({ vectors: [[1]], model: "m" }) });
        const provider = new ModelClientEmbeddingProvider({
            modelClient: client,
            appStores: createStores(),
            defaultProviderApiKeys: { "mistral.ai": "default-key" },
        });

        try {
            await provider.embed({ text: "hi", purpose: "p" });
            assert.fail("expected throw");
        } catch (error) {
            assert.ok(error instanceof ModelClientEmbeddingProviderError);
            assert.equal(error.code, "assignment_missing");
            assert.match(error.message, /memory\.embed/);
        }
    });

    it("throws api_key_missing when no credential and no default key for the provider", async () => {
        const { client } = makeModelClient({ embed: () => ({ vectors: [[1]], model: "m" }) });
        const provider = new ModelClientEmbeddingProvider({
            modelClient: client,
            appStores: createStores(),
            defaultModelAssignments: {
                "memory.embed": { provider: "mistral.ai", model: "mistral-embed" },
            },
        });

        try {
            await provider.embed({ text: "hi", purpose: "p" });
            assert.fail("expected throw");
        } catch (error) {
            assert.ok(error instanceof ModelClientEmbeddingProviderError);
            assert.equal(error.code, "api_key_missing");
            assert.match(error.message, /mistral\.ai/);
        }
    });

    it("throws embed_unsupported when model client does not implement embed()", async () => {
        const { client } = makeModelClient({}); // no embed
        const provider = new ModelClientEmbeddingProvider({
            modelClient: client,
            appStores: createStores(),
            defaultModelAssignments: {
                "memory.embed": { provider: "mistral.ai", model: "mistral-embed" },
            },
            defaultProviderApiKeys: { "mistral.ai": "default-key" },
        });

        try {
            await provider.embed({ text: "hi", purpose: "p" });
            assert.fail("expected throw");
        } catch (error) {
            assert.ok(error instanceof ModelClientEmbeddingProviderError);
            assert.equal(error.code, "embed_unsupported");
        }
    });

    it("wraps model client errors as embed_failed with cause attached", async () => {
        const underlying = new Error("upstream 503");
        const { client } = makeModelClient({
            embed: () => { throw underlying; },
        });
        const provider = new ModelClientEmbeddingProvider({
            modelClient: client,
            appStores: createStores(),
            defaultModelAssignments: {
                "memory.embed": { provider: "mistral.ai", model: "mistral-embed" },
            },
            defaultProviderApiKeys: { "mistral.ai": "default-key" },
        });

        try {
            await provider.embed({ text: "hi", purpose: "p" });
            assert.fail("expected throw");
        } catch (error) {
            assert.ok(error instanceof ModelClientEmbeddingProviderError);
            assert.equal(error.code, "embed_failed");
            assert.equal((error as ModelClientEmbeddingProviderError).cause, underlying);
        }
    });

    it("throws empty_response when model client returns no vector", async () => {
        const { client } = makeModelClient({
            embed: () => ({ vectors: [], model: "m" }),
        });
        const provider = new ModelClientEmbeddingProvider({
            modelClient: client,
            appStores: createStores(),
            defaultModelAssignments: {
                "memory.embed": { provider: "mistral.ai", model: "mistral-embed" },
            },
            defaultProviderApiKeys: { "mistral.ai": "default-key" },
        });

        try {
            await provider.embed({ text: "hi", purpose: "p" });
            assert.fail("expected throw");
        } catch (error) {
            assert.ok(error instanceof ModelClientEmbeddingProviderError);
            assert.equal(error.code, "empty_response");
        }
    });

    it("throws invalid_response when model client returns a vector with non-finite values", async () => {
        const cases: number[][] = [
            [1, Number.NaN, 3],
            [1, Number.POSITIVE_INFINITY],
            [1, Number.NEGATIVE_INFINITY],
        ];
        for (const vector of cases) {
            const { client } = makeModelClient({
                embed: () => ({ vectors: [vector], model: "m" }),
            });
            const provider = new ModelClientEmbeddingProvider({
                modelClient: client,
                appStores: createStores(),
                defaultModelAssignments: {
                    "memory.embed": { provider: "mistral.ai", model: "mistral-embed" },
                },
                defaultProviderApiKeys: { "mistral.ai": "default-key" },
            });
            try {
                await provider.embed({ text: "hi", purpose: "p" });
                assert.fail(`expected throw for vector ${JSON.stringify(vector)}`);
            } catch (error) {
                assert.ok(error instanceof ModelClientEmbeddingProviderError);
                assert.equal(error.code, "invalid_response", `vector ${JSON.stringify(vector)}`);
            }
        }
    });

    it("throws invalid_response when the vector contains non-number elements", async () => {
        const { client } = makeModelClient({
            // model client contract is typed number[][], but a misbehaving
            // adapter could leak garbage; we still need to defend.
            embed: () => ({ vectors: [[1, "two" as unknown as number, 3]], model: "m" }),
        });
        const provider = new ModelClientEmbeddingProvider({
            modelClient: client,
            appStores: createStores(),
            defaultModelAssignments: {
                "memory.embed": { provider: "mistral.ai", model: "mistral-embed" },
            },
            defaultProviderApiKeys: { "mistral.ai": "default-key" },
        });
        try {
            await provider.embed({ text: "hi", purpose: "p" });
            assert.fail("expected throw");
        } catch (error) {
            assert.ok(error instanceof ModelClientEmbeddingProviderError);
            assert.equal(error.code, "invalid_response");
        }
    });

    it("respects custom embeddingVersion in the returned signature", async () => {
        const { client } = makeModelClient({
            embed: () => ({ vectors: [[1, 2]], model: "m" }),
        });
        const provider = new ModelClientEmbeddingProvider({
            modelClient: client,
            appStores: createStores(),
            defaultModelAssignments: {
                "memory.embed": { provider: "mistral.ai", model: "mistral-embed" },
            },
            defaultProviderApiKeys: { "mistral.ai": "default-key" },
            embeddingVersion: 7,
        });

        const result = await provider.embed({ text: "hi", purpose: "p" });
        assert.equal(result.embedding.version, 7);
    });

    it("uses MEMORY_EMBED_PURPOSE as the resolved assignment key", () => {
        // Compile-time + runtime guard: the adapter wires this exact key.
        assert.equal(MEMORY_EMBED_PURPOSE, "memory.embed");
    });
});
