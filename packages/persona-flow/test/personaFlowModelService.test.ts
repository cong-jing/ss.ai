import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
    ModelClient,
    ModelClientFactoryInput,
    PersonaPromptLogEntry,
    UserPreferences,
    UserProviderCredential,
} from "../src/index.js";
import { PersonaFlowModelService } from "../src/index.js";

class FakePreferencesStore {
    constructor(private readonly data: UserPreferences | null) { }
    async getUserPreferences(): Promise<UserPreferences | null> { return this.data; }
    async upsertUserPreferences(): Promise<void> { }
    async setCurrentCharacter(): Promise<void> { }
    async setFunctionModel(): Promise<void> { }
}

class FakeCredentialStore {
    constructor(private readonly credential: UserProviderCredential | null) { }
    async getCredential(): Promise<UserProviderCredential | null> { return this.credential; }
    async upsertCredential(): Promise<void> { }
    async deleteCredential(): Promise<void> { }
    async listCredentials(): Promise<UserProviderCredential[]> { return this.credential ? [this.credential] : []; }
}

describe("persona-flow model service", () => {
    it("selects model by function name and passes config to client factory", async () => {
        const now = new Date().toISOString();
        const prefs: UserPreferences = {
            userId: "u1",
            functionModels: {
                chat: { provider: "mistral", model: "chat-model" },
                summarize: { provider: "mistral", model: "sum-model" },
            },
            createdAt: now,
            updatedAt: now,
        };
        const credential: UserProviderCredential = {
            userId: "u1",
            provider: "mistral",
            apiKeyEncrypted: "k",
            createdAt: now,
            updatedAt: now,
        };

        const capturedInputs: ModelClientFactoryInput[] = [];
        const logs: PersonaPromptLogEntry[] = [];

        const fakeClient: ModelClient = {
            generateNonStructured: async () => ({ output: "ok", toolCalls: [] }),
            generateNonStructuredStream: async () => ({ output: "", toolCalls: [], completed: true }),
            generateStructured: async () => ({
                structuredOutput: {
                    action: "reply",
                    replyText: "structured",
                    control: {
                        summarizeSuggested: false,
                        summarizeReason: "",
                        summarizeUrgency: "none",
                    },
                    skip: {
                        reasonCode: "none",
                        reason: "",
                    },
                },
                toolCalls: [],
            }),
            listModels: async () => ["m1"],
        };

        const service = new PersonaFlowModelService({
            userId: "u1",
            userPreferencesStore: new FakePreferencesStore(prefs),
            providerCredentialStore: new FakeCredentialStore(credential),
            resolveProviderConfig: () => ({ provider: "mistral", apiUrl: "https://example.test" }),
            createModelClient: (input) => {
                capturedInputs.push(input);
                return fakeClient;
            },
            timeoutMs: 1000,
            onPromptLog: (entry) => {
                logs.push(entry);
            },
        });

        const response = await service.chat({
            messages: [{ role: "user", content: "hello" }],
            mode: "structured",
            functionName: "summarize",
        });

        assert.equal(response.output, "structured");
        assert.equal(capturedInputs[0].model, "sum-model");
        assert.equal(capturedInputs[0].provider, "mistral");
        assert.equal(logs.length, 1);
        assert.match(logs[0].output, /"functionName": "summarize"/);
    });

    it("returns missing model config error", async () => {
        const now = new Date().toISOString();
        const prefs: UserPreferences = {
            userId: "u1",
            functionModels: {},
            createdAt: now,
            updatedAt: now,
        };

        const service = new PersonaFlowModelService({
            userId: "u1",
            userPreferencesStore: new FakePreferencesStore(prefs),
            providerCredentialStore: new FakeCredentialStore(null),
            resolveProviderConfig: () => ({ provider: "mistral", apiUrl: "https://example.test" }),
            createModelClient: () => {
                throw new Error("should not be called");
            },
            timeoutMs: 1000,
        });

        await assert.rejects(
            () => service.ensureFunctionReady("chat"),
            /Chat model is not configured/i,
        );
    });
});
