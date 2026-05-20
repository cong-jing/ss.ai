import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AppStores, ModelClient, PersonaFlowPromptLogEntry, UserPreferences, UserProviderCredential } from "../src/index.js";
import { ModelCallExecutor } from "../src/chatTurn/modelCallExecutor.js";

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
    preferences: UserPreferences | null;
    credential: UserProviderCredential | null;
}): AppStores {
    return {
        userPreferences: new FakePreferencesStore(input.preferences),
        providerCredential: new FakeCredentialStore(input.credential),
    } as unknown as AppStores;
}

describe("model call executor", () => {
    it("selects model by model-call purpose and passes runtime to model client", async () => {
        const now = new Date().toISOString();
        const prefs: UserPreferences = {
            userId: "u1",
            modelAssignments: {
                "chat.main": { provider: "mistral", model: "chat-model" },
                "memory.summarize": { provider: "mistral", model: "sum-model" },
            },
            createdAt: now,
            updatedAt: now,
        };
        const credential: UserProviderCredential = {
            userId: "u1",
            provider: "mistral",
            encryptedApiKey: "k",
            createdAt: now,
            updatedAt: now,
        };

        const capturedInputs: Array<{ provider: string; model: string; encryptedApiKey: string }> = [];
        const logs: PersonaFlowPromptLogEntry[] = [];

        const fakeClient: ModelClient = {
            generateNonStructured: async (input) => {
                capturedInputs.push(input);
                return { output: "ok", toolCalls: [] };
            },
            generateNonStructuredStream: async () => ({ output: "", toolCalls: [], completed: true }),
            generateStructured: async (input) => {
                capturedInputs.push(input);
                return {
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
                };
            },
            listModels: async () => ["m1"],
        };

        const executor = new ModelCallExecutor({
            modelClient: fakeClient,
            appStores: createStores({ preferences: prefs, credential }),
            promptLogger: {
                writePromptLog: async (entry) => {
                    logs.push(entry);
                },
            },
        });

        const response = await executor.chat({
            userId: "u1",
            characterId: "c1",
            messages: [{ role: "user", content: "hello" }],
            llmResponseMode: "structured",
            modelCallPurpose: "memory.summarize",
        });

        assert.equal(response.output, "structured");
        assert.equal(capturedInputs[0].model, "sum-model");
        assert.equal(capturedInputs[0].provider, "mistral");
        assert.equal(capturedInputs[0].encryptedApiKey, "k");
        assert.equal(logs.length, 1);
        assert.match(logs[0].output, /"modelCallPurpose": "memory\.summarize"/);
    });

    it("returns missing model assignment error", async () => {
        const now = new Date().toISOString();
        const prefs: UserPreferences = {
            userId: "u1",
            modelAssignments: {},
            createdAt: now,
            updatedAt: now,
        };

        const fakeClient: ModelClient = {
            generateNonStructured: async () => {
                throw new Error("should not be called");
            },
            generateNonStructuredStream: async () => {
                throw new Error("should not be called");
            },
            generateStructured: async () => {
                throw new Error("should not be called");
            },
            listModels: async () => [],
        };

        const executor = new ModelCallExecutor({
            modelClient: fakeClient,
            appStores: createStores({ preferences: prefs, credential: null }),
            promptLogger: { writePromptLog: async () => { } },
        });

        await assert.rejects(
            () => executor.chat({
                userId: "u1",
                characterId: "c1",
                messages: [{ role: "user", content: "hello" }],
                modelCallPurpose: "chat.main",
            }),
            /Chat\.main model is not configured/i,
        );
    });
});
