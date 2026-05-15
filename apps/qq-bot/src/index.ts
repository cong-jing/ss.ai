import { config } from "dotenv";
import { fileURLToPath } from "url";
import { dirname, isAbsolute, resolve } from "path";
import WebSocket from "ws";
import {
    createLogger,
    setGlobalLogger,
    getGlobalLogger,
    parseLogLevel,
    type LoggerOptions,
} from "@ss-ai/persona-flow-logger";
import {
    findCharacterByName,
    listConversations,
} from "./http/serverClient.js";
import {
    configureConversationStore,
} from "./conversationStore.js";
import { createMessageHandlerContext } from "./handlers/messageHandlerContext.js";
import { handleGroupMessage } from "./handlers/groupMessageHandler.js";
import { handlePrivateMessage } from "./handlers/privateMessageHandler.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "../../..");

function resolveConfigPath(argv: string[]): string {
    const shortIndex = argv.indexOf("-c");
    if (shortIndex >= 0 && argv[shortIndex + 1]) {
        return resolve(process.cwd(), argv[shortIndex + 1]);
    }

    const longIndex = argv.indexOf("--config");
    if (longIndex >= 0 && argv[longIndex + 1]) {
        return resolve(process.cwd(), argv[longIndex + 1]);
    }

    return resolve(__dirname, "../.env");
}

function resolvePathFromProject(input: string | undefined, fallbackRelativePath: string): string {
    const raw = input?.trim();
    if (!raw) {
        return resolve(projectRoot, fallbackRelativePath);
    }
    return isAbsolute(raw) ? raw : resolve(projectRoot, raw);
}

const configPath = resolveConfigPath(process.argv.slice(2));
const dotenvResult = config({ path: configPath });

const ONEBOT_WS_URL = process.env.NAPCAT_WS_URL
    ?? process.env.ONEBOT_WS_URL
    ?? "ws://127.0.0.1:3001";
const ONEBOT_ACCESS_TOKEN = process.env.NAPCAT_ACCESS_TOKEN
    ?? process.env.ONEBOT_ACCESS_TOKEN
    ?? "";
const CHARACTER_NAME = process.env.CHARACTER_NAME?.trim() ?? "";
const OUTPUT_DIR = resolvePathFromProject(process.env.OUTPUT_DIR, ".runtime/qq-bot");
const CONVERSATION_MAP_PATH = resolve(OUTPUT_DIR, "conversation-map.json");
const LOG_FILE_PATH = resolvePathFromProject(process.env.LOG_FILE_PATH, ".runtime/qq-bot/qq-bot.log");
const IS_DRY_RUN = ["1", "true", "yes", "on"].includes(
    (process.env.QQ_BOT_DRY_RUN ?? "").trim().toLowerCase(),
);

const loggerOptions: LoggerOptions = {
    level: parseLogLevel(process.env.LOG_LEVEL, {
        strict: true,
        fallbackLevel: "debug",
        onInvalid: (raw, fallback) => {
            process.stderr.write(`[bot] invalid LOG_LEVEL=${String(raw)}; fallback to ${fallback}\n`);
        },
    }),
    logFilePath: LOG_FILE_PATH,
    includeSourceLocation: true,
    includeStackTrace: false,
    clearLogFileOnStart: true,
    stackLevel: 0,
};
setGlobalLogger(createLogger(loggerOptions));
const logger = getGlobalLogger();

if (dotenvResult.error) {
    logger.warn(`[bot] failed to load config file: ${configPath}`);
} else {
    logger.info(`[bot] loaded config file: ${configPath}`);
}

configureConversationStore(CONVERSATION_MAP_PATH);

const wsUrl = ONEBOT_ACCESS_TOKEN
    ? `${ONEBOT_WS_URL}?access_token=${ONEBOT_ACCESS_TOKEN}`
    : ONEBOT_WS_URL;

const ws = new WebSocket(wsUrl, {
    headers: ONEBOT_ACCESS_TOKEN
        ? { Authorization: `Bearer ${ONEBOT_ACCESS_TOKEN}` }
        : {},
});

const messageHandlerContext = createMessageHandlerContext({
    config: { isDryRun: IS_DRY_RUN },
    sendAction: (action: string, params: Record<string, unknown>): void => {
        const payload = {
            action,
            params,
            echo: `echo-${Date.now()}`,
        };
        logger.info("[bot] sending action", payload);
        ws.send(JSON.stringify(payload));
    },
});

ws.on("open", () => {
    logger.info("[bot] connected to NapCat OneBot");
    logger.info(`[bot] bindings store path: ${CONVERSATION_MAP_PATH}`);
    logger.info(`[bot] log file path: ${LOG_FILE_PATH}`);
    if (IS_DRY_RUN) {
        logger.warn("[bot] dry-run mode enabled: server APIs will be logged but not called");
    }
    const selectedCharacterName = messageHandlerContext.getCharacterName();
    if (selectedCharacterName) {
        logger.info(`[bot] character name: ${selectedCharacterName}`);
    }
    messageHandlerContext.sendAction("get_login_info", {});
});

ws.on("message", (data: { toString(): string }): void => {
    let event: any;
    try {
        event = JSON.parse(data.toString());
    } catch {
        logger.warn("[bot] failed to parse message", { raw: data.toString() });
        return;
    }

    if (event.echo && typeof event.echo === "string" && event.echo.startsWith("echo-")) {
        if (event.data?.user_id != null) {
            messageHandlerContext.setBotSelfId(event.data.user_id);
            logger.info("[bot] NapCat login info", {
                selfId: event.data.user_id,
                nickname: event.data.nickname ?? null,
            });
        }
    }

    if (event.post_type === "message") {
        const handleIncomingMessage = async (event: any) => {
            logger.info("[bot] incoming message event", event);

            if (event.self_id != null) {
                messageHandlerContext.setBotSelfId(event.self_id);
            }

            const botSelfId = messageHandlerContext.getBotSelfId();
            if (botSelfId != null && event.user_id === botSelfId) {
                return;
            }

            if (event.message_type === "group") {
                await handleGroupMessage(event, messageHandlerContext);
                return;
            }

            await handlePrivateMessage(event, messageHandlerContext);
        };
        handleIncomingMessage(event).catch((err) => {
            logger.error("[bot] error handling message", err);
        });
    }
});

ws.on("error", (err) => {
    logger.error("[bot] websocket error", err);
});

ws.on("close", () => {
    logger.warn("[bot] websocket closed");
});


async function initializeCharacter(): Promise<void> {
    if (!CHARACTER_NAME) {
        logger.error("[bot] CHARACTER_NAME is required in config.");
        return;
    }

    const { matches, activeCharacterId } = await findCharacterByName(CHARACTER_NAME);
    if (matches.length === 0) {
        logger.error(`[bot] character not found by name: ${CHARACTER_NAME}`);
        return;
    }
    if (matches.length > 1) {
        const duplicateIds = matches.map(item => item.id).join(", ");
        logger.error(`[bot] duplicate character names found: ${CHARACTER_NAME}, ids=${duplicateIds}`);
        return;
    }

    const character = matches[0];
    messageHandlerContext.setCharacter(character.id, character.name);

    const conversationInfo = await listConversations(character.id);
    logger.info("[bot] character initialized", {
        id: character.id,
        name: character.name,
        displayName: character.displayName,
        activeCharacterId,
        activeConversationId: conversationInfo.activeConversationId,
        conversationCount: conversationInfo.conversations.length,
    });
}

initializeCharacter().catch((err) => {
    logger.error("[bot] failed to initialize character", err);
});
