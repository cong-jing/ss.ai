export interface ConnectView {
    providerEl: HTMLSelectElement;
    apiKeyEl: HTMLInputElement;
    connectBtnEl: HTMLButtonElement;
    statusEl: HTMLParagraphElement;
    modelsEl: HTMLSelectElement;
}

export function getConnectView(): ConnectView {
    const providerEl = document.getElementById("provider") as HTMLSelectElement | null;
    const apiKeyEl = document.getElementById("apiKey") as HTMLInputElement | null;
    const connectBtnEl = document.getElementById("connectBtn") as HTMLButtonElement | null;
    const statusEl = document.getElementById("status") as HTMLParagraphElement | null;
    const modelsEl = document.getElementById("models") as HTMLSelectElement | null;

    if (!providerEl || !apiKeyEl || !connectBtnEl || !statusEl || !modelsEl) {
        throw new Error("页面元素缺失，无法初始化连接视图");
    }

    return {
        providerEl,
        apiKeyEl,
        connectBtnEl,
        statusEl,
        modelsEl
    };
}

export function setStatus(view: ConnectView, text: string): void {
    view.statusEl.textContent = text;
}

export function setApiKeyState(view: ConnectView, apiKeySet: boolean): void {
    view.apiKeyEl.value = "";
    view.apiKeyEl.placeholder = apiKeySet ? "已填写（已保存）" : "请输入 API Key";
}

export function renderModels(view: ConnectView, models: string[]): void {
    view.modelsEl.innerHTML = "";

    if (models.length === 0) {
        const option = document.createElement("option");
        option.textContent = "暂无可用模型";
        view.modelsEl.appendChild(option);
        view.modelsEl.disabled = true;
        return;
    }

    for (const model of models) {
        const option = document.createElement("option");
        option.value = model;
        option.textContent = model;
        view.modelsEl.appendChild(option);
    }

    view.modelsEl.disabled = false;
}

export function renderProviders(view: ConnectView, providers: string[], currentProvider?: string): void {
    view.providerEl.innerHTML = "";

    for (const provider of providers) {
        const option = document.createElement("option");
        option.value = provider;
        option.textContent = provider;
        option.selected = currentProvider === provider;
        view.providerEl.appendChild(option);
    }
}

export function setSelectedProvider(view: ConnectView, provider: string | null): void {
    if (!provider) {
        return;
    }

    for (const option of Array.from(view.providerEl.options)) {
        if (option.value === provider) {
            view.providerEl.value = provider;
            return;
        }
    }
}

export function setSelectedModel(view: ConnectView, model: string): void {
    for (const option of Array.from(view.modelsEl.options)) {
        if (option.value === model) {
            view.modelsEl.value = model;
            return;
        }
    }
}

export function readConnectionInput(view: ConnectView): { provider: string; apiKey: string } {
    return {
        provider: view.providerEl.value,
        apiKey: view.apiKeyEl.value.trim()
    };
}
