import "./styles.css";
import { loadUserSettings, upsertCurrentUserSettings } from "./api/apiFacade";
import { initConversationFeature } from "./features/conversation";
import { appState } from "./state/appState";
import {
    getConnectView,
    readConnectionInput,
    renderModels,
    renderProviders,
    setApiKeyState,
    setSelectedModel,
    setSelectedProvider,
    setStatus
} from "./ui/connectView";

async function refreshViewFromServer(view: ReturnType<typeof getConnectView>, statusText: string): Promise<void> {
    const state = await loadUserSettings();
    renderProviders(view, state.providers, state.currentProvider ?? undefined);
    setSelectedProvider(view, state.currentProvider);
    renderModels(view, state.availableModels);
    setSelectedModel(view, state.currentModel ?? "");
    setApiKeyState(view, state.apiKeySet);

    if (state.currentProvider) {
        appState.connection.provider = state.currentProvider;
    }

    appState.availableModels = state.availableModels;
    setStatus(view, statusText);
}

async function boot(): Promise<void> {
    const view = getConnectView();
    initConversationFeature();
    console.info("[ui] boot started");

    try {
        await refreshViewFromServer(view, "设置已加载");
    } catch (error) {
        setStatus(view, error instanceof Error ? error.message : "初始化连接状态失败");
    }

    view.connectBtnEl.addEventListener("click", async () => {
        const input = readConnectionInput(view);
        appState.connection = input;
        console.info("[ui] save clicked", {
            provider: input.provider,
            hasApiKey: Boolean(input.apiKey)
        });

        view.connectBtnEl.disabled = true;
        setStatus(view, "保存中...");

        try {
            const requestModel = view.modelsEl.value || null;
            await upsertCurrentUserSettings({
                provider: input.provider,
                apiKey: input.apiKey || null,
                model: requestModel
            });

            await refreshViewFromServer(view, "设置已保存");
        } catch (error) {
            setStatus(view, error instanceof Error ? error.message : "保存失败");
        } finally {
            view.connectBtnEl.disabled = false;
        }
    });

    view.providerEl.addEventListener("change", async () => {
        const provider = view.providerEl.value;
        console.info("[ui] provider change", { provider });

        try {
            await upsertCurrentUserSettings({
                provider,
                apiKey: null,
                model: null
            });
            await refreshViewFromServer(view, `已切换服务商：${provider}`);
        } catch (error) {
            setStatus(view, error instanceof Error ? error.message : "服务商切换失败");
        }
    });

    view.modelsEl.addEventListener("change", async () => {
        const model = view.modelsEl.value;
        if (!model) {
            return;
        }

        console.info("[ui] model change", { model });

        try {
            await upsertCurrentUserSettings({
                provider: view.providerEl.value,
                apiKey: null,
                model
            });
            setStatus(view, `已切换模型：${model}`);
        } catch (error) {
            setStatus(view, error instanceof Error ? error.message : "模型切换失败");
        }
    });
}

boot().catch((error) => {
    const message = error instanceof Error ? error.message : "初始化失败";
    const status = document.getElementById("status");
    if (status) {
        status.textContent = message;
    }
});
