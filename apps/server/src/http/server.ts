import express from "express";
import path from "node:path";
import { RuntimeConfig } from "../util/config.js";
import { getGlobalLogger } from "../util/logger.js";
import { createAgentServiceFactory } from "./apis/apiContext.js";
import { registerChatRoute } from "./apis/chat.route.js";
import { registerUserSettingsRoutes } from "./apis/userSettings.route.js";
import { registerUserInfoRoutes } from "./apis/userInfo.route.js";
import { registerCharacterInfoRoutes } from "./apis/characterInfo.route.js";
import { UserSettingsStore } from "./userSettingsStore.js";
import { JsonFileStore } from "./jsonFileStore.js";
import { openDatabase, SQLiteMessageStore } from "@ss-ai/persona-flow-sqlite";

export function createHttpServer(config: RuntimeConfig) {
    const app = express();
    const logger = getGlobalLogger();

    const { db } = openDatabase(
        path.join(config.runtimeFiles.userDataDir, "messages.db"),
        (sql: unknown) => logger.verbose("[db]", { sql: String(sql) })
    );
    const messageStore = new SQLiteMessageStore(db);

    const userSettingsStore = new UserSettingsStore(
        path.resolve(config.runtimeFiles.userDataDir, "user-settings.json"),
        {
            currentProvider: null,
            currentModel: null,
            providerApiKeys: {},
            functionModels: {}
        },
        [
            path.resolve(config.runtimeFiles.userDataDir, "user-settings.json"),
            path.resolve(config.runtimeFiles.userDataDir, "settings.json")
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

    app.get("/health", (_req, res) => {
        res.json({ status: "ok" });
    });

    const apiContext = {
        app,
        logger,
        config,
        userSettingsStore,
        messageStore,
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
