import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { submitTurnEventsTool } from "../src/index.js";
import type {
    AppStores,
    ModelClient,
    PersonaFlowPromptLogEntry,
    StructuredOutputSchema,
    UserPreferences,
    UserProviderCredential,
} from "../src/index.js";
import { ModelRuntime } from "../src/modelCall/modelRuntime.js";

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

describe("model runtime", () => {
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

        const capturedInputs: Array<{
            provider: string;
            model: string;
            encryptedApiKey: string;
            structuredOutputSchema?: StructuredOutputSchema;
        }> = [];
        const logs: PersonaFlowPromptLogEntry[] = [];
        const structuredOutputSchema: StructuredOutputSchema = {
            type: "json_schema",
            jsonSchema: {
                name: "memory_summarize_output",
                schemaDefinition: {
                    type: "object",
                    properties: {
                        replyText: { type: "string" },
                    },
                    required: ["replyText"],
                    additionalProperties: false,
                },
                strict: true,
            },
        };

        const fakeClient: ModelClient = {
            generate: async (input) => {
                capturedInputs.push(input);
                if (input.structuredOutputSchema) {
                    return {
                        structuredOutput: {
                            replyText: "structured",
                        },
                        toolCalls: [],
                    };
                }
                return { output: "ok", toolCalls: [] };
            },
            generateStream: async () => ({ output: "", toolCalls: [], completed: true }),
            listModels: async () => ["m1"],
        };

        const executor = new ModelRuntime({
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
            modelCallPurpose: "memory.summarize",
            structuredOutputSchema,
        });

        assert.equal(response.output, "structured");
        assert.equal(response.apiKeySource, "user");
        assert.equal(capturedInputs[0].model, "sum-model");
        assert.equal(capturedInputs[0].provider, "mistral");
        assert.equal(capturedInputs[0].encryptedApiKey, "k");
        assert.equal(capturedInputs[0].structuredOutputSchema, structuredOutputSchema);
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
            generate: async () => {
                throw new Error("should not be called");
            },
            generateStream: async () => {
                throw new Error("should not be called");
            },
            listModels: async () => [],
        };

        const executor = new ModelRuntime({
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

    it("falls back to default model assignment and default provider api key", async () => {
        const capturedInputs: Array<{
            provider: string;
            model: string;
            encryptedApiKey: string;
        }> = [];

        const fakeClient: ModelClient = {
            generate: async (input) => {
                capturedInputs.push(input);
                return { output: "ok", toolCalls: [] };
            },
            generateStream: async () => ({ output: "", toolCalls: [], completed: true }),
            listModels: async () => [],
        };

        const executor = new ModelRuntime({
            modelClient: fakeClient,
            appStores: createStores({ preferences: null, credential: null }),
            promptLogger: { writePromptLog: async () => { } },
            defaultModelAssignments: {
                "chat.main": { provider: "mistral", model: "shared-model" },
            },
            defaultProviderApiKeys: {
                mistral: "shared-key",
            },
        });

        const response = await executor.chat({
            userId: "u1",
            characterId: "c1",
            messages: [{ role: "user", content: "hello" }],
            modelCallPurpose: "chat.main",
        });

        assert.equal(response.output, "ok");
        assert.equal(response.apiKeySource, "default");
        assert.equal(capturedInputs[0].provider, "mistral");
        assert.equal(capturedInputs[0].model, "shared-model");
        assert.equal(capturedInputs[0].encryptedApiKey, "shared-key");
    });

    it("passes tools and tool choice to model client", async () => {
        const capturedInputs: Array<Parameters<ModelClient["generate"]>[0]> = [];

        const fakeClient: ModelClient = {
            generate: async (input) => {
                capturedInputs.push(input);
                return {
                    output: "",
                    toolCalls: [
                        {
                            functionName: "submit_turn_events",
                            arguments: {
                                events: [
                                    { type: "replyText", characterId: "c1", text: "hello" },
                                ],
                            },
                        },
                    ],
                };
            },
            generateStream: async () => ({ output: "", toolCalls: [], completed: true }),
            listModels: async () => [],
        };

        const executor = new ModelRuntime({
            modelClient: fakeClient,
            appStores: createStores({ preferences: null, credential: null }),
            promptLogger: { writePromptLog: async () => { } },
            defaultModelAssignments: {
                "chat.main": { provider: "mistral", model: "shared-model" },
            },
            defaultProviderApiKeys: {
                mistral: "shared-key",
            },
        });

        const response = await executor.chat({
            userId: "u1",
            characterId: "c1",
            messages: [{ role: "user", content: "hello" }],
            modelCallPurpose: "chat.main",
            tools: [submitTurnEventsTool],
            toolChoice: {
                type: "function",
                functionName: "submit_turn_events",
            },
        });

        assert.equal(response.toolCalls.length, 1);
        assert.equal(capturedInputs[0].tools?.[0].name, "submit_turn_events");
        assert.deepEqual(capturedInputs[0].toolChoice, {
            type: "function",
            functionName: "submit_turn_events",
        });
    });
});
