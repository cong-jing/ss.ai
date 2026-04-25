import express from "express";
import path from "node:path";
import { RuntimeConfig } from "../util/config";
import { getGlobalLogger } from "../util/logger";
import { createAgentServiceFactory } from "./apis/apiContext";
import { registerChatRoute } from "./apis/chat.route";
import { registerUserSettingsRoutes } from "./apis/userSettings.route";
import { UserSettingsStore } from "./userSettingsStore";

export function createHttpServer(config: RuntimeConfig) {
    const app = express();
    const logger = getGlobalLogger();

    const userSettingsStore = new UserSettingsStore(
        path.resolve(config.runtimeFiles.userDataDir, "user-settings.json"),
        {
            currentProvider: null,
            currentModel: null,
            providerApiKeys: {}
        },
        [
            path.resolve(config.runtimeFiles.userDataDir, "ai-user-settings.json"),
            path.resolve(config.runtimeFiles.userDataDir, "ai-settings.json")
        ]
    );
    const createAgentServiceFromUserSettings = createAgentServiceFactory(userSettingsStore, config.models, config);

    app.use(express.json());
    app.use("/web", express.static(path.resolve(process.cwd(), "web")));

    app.get("/", (_req, res) => {
        res.redirect("/web");
    });

    app.get("/health", (_req, res) => {
        res.json({ status: "ok" });
    });

    const apiContext = {
        app,
        logger,
        config,
        userSettingsStore,
        createAgentServiceFromUserSettings
    };

    registerUserSettingsRoutes(apiContext);
    registerChatRoute(apiContext);

    return app;
}

export async function startHttpServer(input: {
    config: RuntimeConfig;
}): Promise<void> {
    const app = createHttpServer(input.config);

    await new Promise<void>((resolve) => {
        app.listen(input.config.http.port, input.config.http.host, () => {
            resolve();
        });
    });
}
