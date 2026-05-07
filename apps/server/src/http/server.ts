import express from "express";
import path from "node:path";
import { RuntimeConfig } from "../util/config.js";
import { getGlobalLogger } from "../util/logger.js";
import { registerChatRoute } from "./apis/chat.route.js";
import { registerUserPreferenceRoutes } from "./apis/userPreference.route.js";
import { registerUserProfileRoutes } from "./apis/userProfile.route.js";
import { registerCharacterRoutes } from "./apis/character.route.js";
import {
    openDatabase,
    SQLiteMessageStore,
    SQLiteCharacterStore,
    SQLiteUserProfileStore,
    SQLiteUserPreferencesStore,
    SQLiteUserProviderCredentialStore,
    SQLiteUserCharacterStateStore,
} from "@ss-ai/persona-flow-sqlite";
import type {
    CharacterStore,
    UserProfileStore,
    UserPreferencesStore,
    UserProviderCredentialStore,
    UserCharacterStateStore,
} from "@ss-ai/persona-flow";

export interface ServerStoreOverrides {
    characterStore?: CharacterStore;
    userProfileStore?: UserProfileStore;
    userPreferencesStore?: UserPreferencesStore;
    userCharacterStateStore?: UserCharacterStateStore;
    userProviderCredentialStore?: UserProviderCredentialStore;
}

export function createHttpServer(config: RuntimeConfig, overrides?: ServerStoreOverrides) {
    const app = express();
    const logger = getGlobalLogger();

    const { db } = openDatabase(
        path.join(config.runtimeFiles.userDataDir, "app.db"),
        (sql: unknown) => logger.verbose("[db]", { sql: String(sql) })
    );

    const messageStore = new SQLiteMessageStore(db);
    const characterStore = overrides?.characterStore ?? new SQLiteCharacterStore(db);
    const userProfileStore = overrides?.userProfileStore ?? new SQLiteUserProfileStore(db);
    const userPreferencesStore = overrides?.userPreferencesStore ?? new SQLiteUserPreferencesStore(db);
    const userCharacterStateStore = overrides?.userCharacterStateStore ?? new SQLiteUserCharacterStateStore(db);
    const userProviderCredentialStore = overrides?.userProviderCredentialStore ?? new SQLiteUserProviderCredentialStore(db);

    app.use(express.json());

    app.get("/health", (_req, res) => {
        res.json({ status: "ok" });
    });

    const apiContext = {
        app,
        logger,
        config,
        characterStore,
        userProfileStore,
        userPreferencesStore,
        userCharacterStateStore,
        userProviderCredentialStore,
        messageStore,
    };

    registerUserPreferenceRoutes(apiContext);
    registerChatRoute(apiContext);
    registerUserProfileRoutes(apiContext);
    registerCharacterRoutes(apiContext);

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
