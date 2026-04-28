import { ref } from "vue";
import {
    apiGetUserSettings,
    apiUpsertApiKey,
    apiDeleteApiKey,
    apiTestApiKey,
    apiUpsertFunctionModel,
    apiListModels
} from "./userSettingsApi";
import type { ProviderState, FunctionModelState } from "./userSettingsTypes";
import { AI_FUNCTIONS, type AiFunction } from "@ss-ai/contracts";

export function useUserSettingsViewModel() {
    const providers = ref<ProviderState[]>([]);
    const functionModels = ref<FunctionModelState[]>([]);
    const isLoading = ref(false);
    const loadError = ref<string | null>(null);
    const isSavingFunctionModel = ref(false);

    async function loadSettings(): Promise<void> {
        isLoading.value = true;
        loadError.value = null;
        try {
            const response = await apiGetUserSettings();

            providers.value = response.providers.map((p) => ({
                provider: p.provider,
                apiKeySet: p.apiKeySet,
                apiKeyInput: null,
                availableModels: p.availableModels,
                isSavingKey: false,
                isTestingKey: false,
                isLoadingModels: false,
                testResult: "none",
                testMessage: ""
            }));

            // Build function model state from response
            const fnStates: FunctionModelState[] = [];
            for (const fn of AI_FUNCTIONS) {
                const assignment = response.functionModels[fn];
                if (assignment) {
                    fnStates.push({ fn, provider: assignment.provider, model: assignment.model });
                } else {
                    fnStates.push({ fn, provider: "", model: "" });
                }
            }
            functionModels.value = fnStates;
        } catch (e) {
            loadError.value = e instanceof Error ? e.message : String(e);
        } finally {
            isLoading.value = false;
        }
    }

    function getProvider(providerName: string): ProviderState | undefined {
        return providers.value.find(p => p.provider === providerName);
    }

    function startEditApiKey(providerName: string): void {
        const p = getProvider(providerName);
        if (p) p.apiKeyInput = "";
    }

    function cancelEditApiKey(providerName: string): void {
        const p = getProvider(providerName);
        if (p) p.apiKeyInput = null;
    }

    async function saveApiKey(providerName: string): Promise<void> {
        const p = getProvider(providerName);
        if (!p || p.apiKeyInput === null) return;

        p.isSavingKey = true;
        p.testResult = "none";
        try {
            const res = await apiUpsertApiKey(providerName, p.apiKeyInput.trim());
            p.apiKeySet = res.apiKeySet;
            p.availableModels = res.availableModels;
            p.apiKeyInput = null;
        } finally {
            p.isSavingKey = false;
        }
    }

    async function deleteApiKey(providerName: string): Promise<void> {
        const p = getProvider(providerName);
        if (!p) return;

        p.isSavingKey = true;
        p.testResult = "none";
        try {
            const res = await apiDeleteApiKey(providerName);
            p.apiKeySet = res.apiKeySet;
            p.availableModels = [];
            p.apiKeyInput = null;
        } finally {
            p.isSavingKey = false;
        }
    }

    async function testApiKey(providerName: string): Promise<void> {
        const p = getProvider(providerName);
        if (!p) return;

        p.isTestingKey = true;
        p.testResult = "none";
        p.testMessage = "";
        try {
            const res = await apiTestApiKey(providerName);
            p.testResult = res.ok ? "ok" : "fail";
            p.testMessage = res.message ?? "";
        } catch (e) {
            p.testResult = "fail";
            p.testMessage = e instanceof Error ? e.message : String(e);
        } finally {
            p.isTestingKey = false;
        }
    }

    async function loadModels(providerName: string): Promise<void> {
        const p = getProvider(providerName);
        if (!p || !p.apiKeySet) return;

        p.isLoadingModels = true;
        try {
            const res = await apiListModels(providerName);
            p.availableModels = res.models;
        } finally {
            p.isLoadingModels = false;
        }
    }

    async function saveFunctionModel(fn: AiFunction, providerName: string, model: string): Promise<void> {
        isSavingFunctionModel.value = true;
        try {
            const res = await apiUpsertFunctionModel(fn, providerName, model);
            for (const fnFn of AI_FUNCTIONS) {
                const assignment = res.functionModels[fnFn];
                const state = functionModels.value.find(f => f.fn === fnFn);
                if (state && assignment) {
                    state.provider = assignment.provider;
                    state.model = assignment.model;
                }
            }
        } finally {
            isSavingFunctionModel.value = false;
        }
    }

    return {
        providers,
        functionModels,
        isLoading,
        loadError,
        isSavingFunctionModel,
        loadSettings,
        startEditApiKey,
        cancelEditApiKey,
        saveApiKey,
        deleteApiKey,
        testApiKey,
        loadModels,
        saveFunctionModel
    };
}
