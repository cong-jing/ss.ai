import { computed, ref } from "vue";
import { getUserSettings, saveUserSettings } from "./userSettingsApi";
import type { UserSettings } from "./userSettingsTypes";

function createEmptySettings(): UserSettings {
    return {
        providers: [],
        currentProvider: null,
        currentModel: null,
        availableModels: [],
        apiKey: "",
        apiKeySet: false
    };
}

export function useUserSettingsViewModel() {
    const settings = ref<UserSettings>(createEmptySettings());
    const isLoading = ref(false);
    const isSaving = ref(false);
    const error = ref<string | null>(null);

    const canSave = computed(() => Boolean(settings.value.currentProvider));

    async function loadSettings(): Promise<void> {
        isLoading.value = true;
        error.value = null;

        try {
            settings.value = await getUserSettings();
        } catch (e) {
            error.value = e instanceof Error ? e.message : String(e);
        } finally {
            isLoading.value = false;
        }
    }

    async function saveSettings(): Promise<void> {
        if (!settings.value.currentProvider) {
            error.value = "请选择 provider";
            return;
        }

        isSaving.value = true;
        error.value = null;

        try {
            const apiKey = settings.value.apiKey.trim();
            settings.value = await saveUserSettings({
                provider: settings.value.currentProvider,
                model: settings.value.currentModel || null,
                apiKey: apiKey ? apiKey : null
            }, settings.value.apiKey);

            settings.value.apiKey = "";
        } catch (e) {
            error.value = e instanceof Error ? e.message : String(e);
        } finally {
            isSaving.value = false;
        }
    }

    return {
        settings,
        isLoading,
        isSaving,
        error,
        canSave,
        loadSettings,
        saveSettings
    };
}
