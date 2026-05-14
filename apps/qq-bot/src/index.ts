import { config } from "dotenv";
import { fileURLToPath } from "url";
import { dirname, isAbsolute, resolve } from "path";
import WebSocket from "ws";
import {
    findCharacterByName,
    listConversations,
    createConversation,
    createLocalActor,
    chat,
} from "./serverClient.js";
import {
    configureConversationStore,
    getConversationId,
    setConversationId,
} from "./conversationStore.js";
import { configureLogger, log, logError, logInfo, logWarn } from "./logger.js";
import { handlePrivateMessage } from "./handlers/privateMessageHandler.js";
import { handleGroupMessage } from "./handlers/groupMessageHandler.js";
import type { MessageHandlerContext } from "./handlers/messageHandlerContext.js";
import { createWsMessageDispatcher } from "./wsMessageDispatcher.js";

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

configureLogger(LOG_FILE_PATH);

if (dotenvResult.error) {
    logWarn(`[bot] failed to load config file: ${configPath}`);
} else {
    logInfo(`[bot] loaded config file: ${configPath}`);
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

let selectedCharacterId: string | null = null;
let selectedCharacterName: string | null = null;
let botSelfId: string | number | null = null;

const messageHandlerContext: MessageHandlerContext = {
    getCharacterId: () => selectedCharacterId,
    getBotSelfId: () => botSelfId,
    resolveConversationId: async (type, id) => {
        const characterId = selectedCharacterId;
        if (!characterId) {
            logWarn("[bot] character not initialized, skipping message");
            return null;
        }
        return resolveConversationId(characterId, type, id);
    },
    createLocalActor,
    chat: async (conversationId, userMessageText, senderActorId) => {
        const characterId = selectedCharacterId;
        if (!characterId) {
            logWarn("[bot] character not initialized, skipping message");
            return null;
        }
        logInfo(`[bot] chat: character=${characterId}, conversation=${conversationId}, senderActorId=${senderActorId ?? "(none)"}, userMessageText="${userMessageText}"`);
        const reply = await chat(characterId, conversationId, userMessageText, senderActorId);
        if (reply == null) {
            logInfo("[bot] chat skipped by structured decision");
            return null;
        }
        logInfo(`[bot] reply: "${reply}"`);
        return reply;
    },
    sendAction,
};

function sendAction(action: string, params: Record<string, unknown>): void {
    const payload = {
        action,
        params,
        echo: `echo-${Date.now()}`,
    };
    ws.send(JSON.stringify(payload));
}

/**
 * Get or create a conversationId for a given QQ user or group.
 * If the conversation doesn't exist yet, a new one is created on the server.
 */
async function resolveConversationId(
    characterId: string,
    type: "user" | "group",
    id: string | number,
): Promise<string> {
    let conversationId = getConversationId(type, id);
    if (!conversationId) {
        logInfo(`[bot] no conversation for ${type}:${id}, creating new one`);
        conversationId = await createConversation(characterId);
        setConversationId(type, id, conversationId);
    }
    return conversationId;
}

async function initializeCharacter(): Promise<void> {
    if (!CHARACTER_NAME) {
        logError("[bot] CHARACTER_NAME is required in config.");
        return;
    }

    const { matches, activeCharacterId } = await findCharacterByName(CHARACTER_NAME);
    if (matches.length === 0) {
        logError(`[bot] character not found by name: ${CHARACTER_NAME}`);
        return;
    }
    if (matches.length > 1) {
        const duplicateIds = matches.map(item => item.id).join(", ");
        logError(`[bot] duplicate character names found: ${CHARACTER_NAME}, ids=${duplicateIds}`);
        return;
    }

    const character = matches[0];
    selectedCharacterId = character.id;
    selectedCharacterName = character.name;

    const conversationInfo = await listConversations(character.id);
    logInfo("[bot] character initialized", {
        id: character.id,
        name: character.name,
        displayName: character.displayName,
        activeCharacterId,
        activeConversationId: conversationInfo.activeConversationId,
        conversationCount: conversationInfo.conversations.length,
    });
}

async function handleIncomingMessage(event: any): Promise<void> {
    logInfo("[bot] incoming message event", event);

    if (event.self_id != null) {
        botSelfId = event.self_id;
    }

    if (botSelfId != null && event.user_id === botSelfId) {
        return;
    }

    if (event.message_type === "group") {
        await handleGroupMessage(event, messageHandlerContext);
        return;
    }

    await handlePrivateMessage(event, messageHandlerContext);
}

ws.on("open", () => {
    logInfo("[bot] connected to NapCat OneBot");
    logInfo(`[bot] bindings store path: ${CONVERSATION_MAP_PATH}`);
    logInfo(`[bot] log file path: ${LOG_FILE_PATH}`);
    if (IS_DRY_RUN) {
        logWarn("[bot] dry-run mode enabled: server APIs will be logged but not called");
    }
    if (selectedCharacterName) {
        logInfo(`[bot] character name: ${selectedCharacterName}`);
    }
    sendAction("get_login_info", {});
});

ws.on("message", createWsMessageDispatcher({
    handleIncomingMessage,
    setBotSelfId: (id) => {
        botSelfId = id;
    },
    logInfo,
    logWarn,
    logError,
}));

ws.on("error", (err) => {
    logError("[bot] websocket error:", err);
});

ws.on("close", () => {
    logWarn("[bot] websocket closed");
});

initializeCharacter().catch((err) => {
    logError("[bot] failed to initialize character:", err);
});
