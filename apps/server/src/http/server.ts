import express from "express";
import path from "node:path";
import fs from "node:fs";
import { RuntimeConfig } from "../util/config.js";
import { getGlobalLogger } from "@ss-ai/persona-flow-logger";
import { registerChatRoute } from "./apis/chat.route.js";
import { registerUserPreferenceRoutes } from "./apis/userPreference.route.js";
import { registerUserProfileRoutes } from "./apis/userProfile.route.js";
import { registerCharacterRoutes } from "./apis/character.route.js";
import { registerConversationRoutes } from "./apis/conversation.route.js";
import { registerConversationActorRoutes } from "./apis/conversationActor.route.js";
import {
    openDatabase,
    createSqliteStores,
} from "@ss-ai/persona-flow-sqlite";
import type { AppStores } from "@ss-ai/persona-flow";
import { createAuthRuntime } from "../auth/authRuntime.js";
import { registerAuthRoutes } from "../auth/auth.route.js";
import { getErrorStatusCode, toAuthErrorResponse } from "../auth/errors.js";

export interface ServerStoreOverrides {
    stores?: AppStores;
}

export function createHttpServer(config: RuntimeConfig, overrides?: ServerStoreOverrides) {
    const app = express();
    const logger = getGlobalLogger();

    app.use((req, res, next) => {
        const start = Date.now()
        let responseBody: unknown
        const originalJson = res.json.bind(res)
        res.json = (body) => {
            responseBody = body
            return originalJson(body)
        }
        res.on("finish", () => {
            const ms = Date.now() - start
            const level = res.statusCode >= 500 ? "error"
                : res.statusCode >= 400 ? "warn"
                    : "debug"
            logger[level](`[http] ${req.method} ${req.path} → ${res.statusCode} (${ms}ms)`)
            if (res.locals.routeError) {
                const err = res.locals.routeError
                logger.error(`[http] route error:`, { message: err instanceof Error ? err.message : String(err), stack: err instanceof Error ? err.stack : undefined })
            }
            const reqBody = req.body && Object.keys(req.body).length > 0
                ? " req:" + JSON.stringify(req.body).slice(0, 300)
                : ""
            const resBody = responseBody !== undefined
                ? " res:" + JSON.stringify(responseBody).slice(0, 300)
                : ""
            if (reqBody || resBody) logger.verbose(`[http]${reqBody}${resBody}`)
        })
        next()
    })

    const { sqlite, db } = openDatabase(
        path.join(config.runtimeFiles.userDataDir, "app.db"),
        (sql: unknown) => logger.verbose("[db]", { sql: String(sql) })
    );

    const characterDbDir = path.join(config.runtimeFiles.userDataDir, "characters");
    fs.mkdirSync(characterDbDir, { recursive: true });
    const stores = overrides?.stores ?? createSqliteStores({
        db,
        characterDbDir,
        dblog: (sql: unknown) => logger.verbose("[db.character]", { sql: String(sql) }),
    });
    const authRuntime = createAuthRuntime({
        config: config.auth,
        sqlite,
    });

    app.use(express.json());

    app.get("/health", (_req, res) => {
        res.json({ status: "ok" });
    });

    const apiContext = {
        app,
        logger,
        config,
        stores,
        authRuntime,
    };

    registerAuthRoutes(apiContext);

    app.use("/v1", async (req, res, next) => {
        if (req.path.startsWith("/auth/")) {
            next();
            return;
        }
        try {
            await authRuntime.requireUser(req);
            next();
        } catch (error) {
            res.status(getErrorStatusCode(error, 401)).json(toAuthErrorResponse(error));
        }
    });

    registerUserPreferenceRoutes(apiContext);
    registerChatRoute(apiContext);
    registerUserProfileRoutes(apiContext);
    registerCharacterRoutes(apiContext);
    registerConversationRoutes(apiContext);
    registerConversationActorRoutes(apiContext);

    (app as typeof app & { closeDatabase?: () => void }).closeDatabase = () => {
        sqlite.close();
    };

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
