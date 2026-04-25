import fs from "node:fs";
import path from "node:path";

export interface UserSettings {
    currentProvider: string | null;
    currentModel: string | null;
    providerApiKeys: Record<string, string>;
}

interface LegacyUserSettings {
    provider?: unknown;
    model?: unknown;
    apiKey?: unknown;
}

export class UserSettingsStore {
    constructor(
        private readonly filePath: string,
        private readonly initialValue: UserSettings,
        private readonly legacyFilePaths: string[] = []
    ) {
        fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
        this.migrateLegacyIfNeeded();

        if (!fs.existsSync(this.filePath)) {
            this.write(this.initialValue);
        }
    }

    read(): UserSettings {
        if (!fs.existsSync(this.filePath)) {
            this.write(this.initialValue);
            return this.initialValue;
        }

        const raw = fs.readFileSync(this.filePath, "utf-8");
        const parsed = JSON.parse(raw) as unknown;
        return this.normalizeSettings(parsed);
    }

    update(patch: Partial<UserSettings>): UserSettings {
        const current = this.read();
        const nextCurrentProvider = Object.prototype.hasOwnProperty.call(patch, "currentProvider")
            ? patch.currentProvider ?? null
            : current.currentProvider;
        const nextCurrentModel = Object.prototype.hasOwnProperty.call(patch, "currentModel")
            ? patch.currentModel ?? null
            : current.currentModel;

        const next: UserSettings = {
            currentProvider: nextCurrentProvider,
            currentModel: nextCurrentModel,
            providerApiKeys: {
                ...current.providerApiKeys,
                ...(patch.providerApiKeys ?? {})
            }
        };

        this.write(next);
        return next;
    }

    setApiKey(provider: string, apiKey: string | null): UserSettings {
        const normalizedProvider = provider.trim().toLowerCase();
        const current = this.read();
        const providerApiKeys = { ...current.providerApiKeys };

        if (apiKey && apiKey.trim()) {
            providerApiKeys[normalizedProvider] = apiKey.trim();
        }

        const next: UserSettings = {
            ...current,
            providerApiKeys
        };

        this.write(next);
        return next;
    }

    getApiKey(provider: string | null): string | null {
        if (!provider) {
            return null;
        }

        const settings = this.read();
        const apiKey = settings.providerApiKeys[provider.trim().toLowerCase()];
        if (!apiKey || !apiKey.trim()) {
            return null;
        }

        return apiKey;
    }

    private normalizeSettings(parsed: unknown): UserSettings {
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            return this.initialValue;
        }

        const data = parsed as Partial<UserSettings> & LegacyUserSettings;
        const currentProvider = typeof data.currentProvider === "string" && data.currentProvider.trim()
            ? data.currentProvider.trim().toLowerCase()
            : (typeof data.provider === "string" && data.provider.trim()
                ? data.provider.trim().toLowerCase()
                : this.initialValue.currentProvider);

        const currentModel = typeof data.currentModel === "string" && data.currentModel.trim()
            ? data.currentModel.trim()
            : (typeof data.model === "string" && data.model.trim()
                ? data.model.trim()
                : this.initialValue.currentModel);

        const providerApiKeys: Record<string, string> = { ...this.initialValue.providerApiKeys };

        if (data.providerApiKeys && typeof data.providerApiKeys === "object" && !Array.isArray(data.providerApiKeys)) {
            for (const [provider, key] of Object.entries(data.providerApiKeys)) {
                if (typeof provider === "string" && provider.trim() && typeof key === "string" && key.trim()) {
                    providerApiKeys[provider.trim().toLowerCase()] = key.trim();
                }
            }
        }

        if (typeof data.provider === "string" && data.provider.trim() && typeof data.apiKey === "string" && data.apiKey.trim()) {
            providerApiKeys[data.provider.trim().toLowerCase()] = data.apiKey.trim();
        }

        return {
            currentProvider,
            currentModel,
            providerApiKeys
        };
    }

    private migrateLegacyIfNeeded(): void {
        if (fs.existsSync(this.filePath)) {
            return;
        }

        for (const legacyFilePath of this.legacyFilePaths) {
            if (!legacyFilePath || !fs.existsSync(legacyFilePath)) {
                continue;
            }

            const raw = fs.readFileSync(legacyFilePath, "utf-8");
            const parsed = JSON.parse(raw) as unknown;
            const migrated = this.normalizeSettings(parsed);
            this.write(migrated);
            return;
        }
    }

    private write(value: UserSettings): void {
        fs.writeFileSync(this.filePath, JSON.stringify(value, null, 4), "utf-8");
    }
}
