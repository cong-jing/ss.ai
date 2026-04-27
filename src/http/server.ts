import express from "express";
import path from "node:path";
import { RuntimeConfig } from "../util/config";
import { getGlobalLogger } from "../util/logger";
import { createAgentServiceFactory } from "./apis/apiContext";
import { registerChatRoute } from "./apis/chat.route";
import { registerUserSettingsRoutes } from "./apis/userSettings.route";
import { registerUserInfoRoutes } from "./apis/userInfo.route";
import { registerCharacterInfoRoutes } from "./apis/characterInfo.route";
import { UserSettingsStore } from "./userSettingsStore";
import { JsonFileStore } from "./jsonFileStore";

export function createHttpServer(config: RuntimeConfig) {
    const app = express();
    const logger = getGlobalLogger();
    const webDistDir = path.resolve(process.cwd(), "web", "dist");

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

    const userInfoStore = new JsonFileStore(
        path.resolve(config.runtimeFiles.userDataDir, "user-info.json"),
        { name: "", bio: "" }
    );

    const characterInfoStore = new JsonFileStore(
        path.resolve(config.runtimeFiles.userDataDir, "character-info.json"),
        { name: "", description: "" }
    );

    app.use(express.json());
    app.use(express.static(webDistDir));

    app.get("/", (_req, res) => {
        res.sendFile(path.resolve(webDistDir, "index.html"));
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
    registerUserInfoRoutes(apiContext, userInfoStore);
    registerCharacterInfoRoutes(apiContext, characterInfoStore);

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
