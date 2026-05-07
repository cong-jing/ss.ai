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
    createSqliteStores,
} from "@ss-ai/persona-flow-sqlite";
import type { AppStores } from "@ss-ai/persona-flow";

export interface ServerStoreOverrides {
    stores?: AppStores;
}

export function createHttpServer(config: RuntimeConfig, overrides?: ServerStoreOverrides) {
    const app = express();
    const logger = getGlobalLogger();

    const { db } = openDatabase(
        path.join(config.runtimeFiles.userDataDir, "app.db"),
        (sql: unknown) => logger.verbose("[db]", { sql: String(sql) })
    );

    const stores = overrides?.stores ?? createSqliteStores({ db });

    app.use(express.json());

    app.get("/health", (_req, res) => {
        res.json({ status: "ok" });
    });

    const apiContext = {
        app,
        logger,
        config,
        stores,
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
