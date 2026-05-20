import { ref } from "vue";
import {
    apiGetUserPreference,
    apiUpsertApiKey,
    apiDeleteApiKey,
    apiTestApiKey,
    apiUpsertModelAssignment,
    apiListModels
} from "./userPreferenceApi";
import type { ModelAssignmentState, ProviderState } from "./userPreferenceTypes";
import { MODEL_CALL_PURPOSES, type ModelCallPurpose } from "@ss-ai/contracts";
import { useToast } from "../../shared/ui/useToast";

export function useUserPreferenceViewModel() {
    const toast = useToast();
    const providers = ref<ProviderState[]>([]);
    const modelAssignments = ref<ModelAssignmentState[]>([]);
    const isLoading = ref(false);
    const isSavingModelAssignment = ref(false);

    async function loadSettings(): Promise<void> {
        isLoading.value = true;
        try {
            const response = await apiGetUserPreference();

            providers.value = response.providers.map((p) => ({
                provider: p.provider,
                apiKeySet: p.apiKeySet,
                apiKeyInput: p.apiKeySet ? null : "",
                availableModels: p.availableModels,
                isSavingKey: false,
                isTestingKey: false,
                isLoadingModels: false,
                testResult: "none",
                testMessage: ""
            }));

            const assignmentStates: ModelAssignmentState[] = [];
            for (const purpose of MODEL_CALL_PURPOSES) {
                const assignment = response.modelAssignments[purpose];
                if (assignment) {
                    assignmentStates.push({ purpose, provider: assignment.provider, model: assignment.model });
                } else {
                    assignmentStates.push({ purpose, provider: "", model: "" });
                }
            }
            modelAssignments.value = assignmentStates;
        } catch (e) {
            toast.error(e instanceof Error ? e.message : String(e));
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
        } catch (e) {
            toast.error(e instanceof Error ? e.message : String(e));
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
        } catch (e) {
            toast.error(e instanceof Error ? e.message : String(e));
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
        } catch (e) {
            toast.error(e instanceof Error ? e.message : String(e));
        } finally {
            p.isLoadingModels = false;
        }
    }

    async function saveModelAssignment(modelCallPurpose: ModelCallPurpose, providerName: string, model: string): Promise<void> {
        isSavingModelAssignment.value = true;
        try {
            const res = await apiUpsertModelAssignment(modelCallPurpose, providerName, model);
            for (const purpose of MODEL_CALL_PURPOSES) {
                const assignment = res.modelAssignments[purpose];
                const state = modelAssignments.value.find(f => f.purpose === purpose);
                if (state && assignment) {
                    state.provider = assignment.provider;
                    state.model = assignment.model;
                }
            }
        } catch (e) {
            toast.error(e instanceof Error ? e.message : String(e));
        } finally {
            isSavingModelAssignment.value = false;
        }
    }

    return {
        providers,
        modelAssignments,
        isLoading,
        isSavingModelAssignment,
        loadSettings,
        startEditApiKey,
        cancelEditApiKey,
        saveApiKey,
        deleteApiKey,
        testApiKey,
        loadModels,
        saveModelAssignment
    };
}
