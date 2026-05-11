import { config } from "dotenv";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import WebSocket from "ws";
import {
    getActiveCharacterId,
    createConversation,
    selectConversation,
    chat,
} from "./serverClient.js";
import { getConversationId, setConversationId } from "./conversationStore.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../.env") });

const ONEBOT_WS_URL = process.env.ONEBOT_WS_URL ?? "ws://127.0.0.1:3001";
const ONEBOT_ACCESS_TOKEN = process.env.ONEBOT_ACCESS_TOKEN ?? "";

const wsUrl = ONEBOT_ACCESS_TOKEN
    ? `${ONEBOT_WS_URL}?access_token=${ONEBOT_ACCESS_TOKEN}`
    : ONEBOT_WS_URL;

const ws = new WebSocket(wsUrl, {
    headers: ONEBOT_ACCESS_TOKEN
        ? { Authorization: `Bearer ${ONEBOT_ACCESS_TOKEN}` }
        : {},
});

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
        console.log(`[bot] no conversation for ${type}:${id}, creating new one`);
        conversationId = await createConversation(characterId);
        setConversationId(type, id, conversationId);
    }
    return conversationId;
}

async function handleMessage(event: any): Promise<void> {
    // ignore self messages
    if (event.self_id != null && event.user_id === event.self_id) {
        return;
    }

    const text: string = (event.raw_message ?? "").trim();
    if (!text) {
        return;
    }

    // Determine conversation scope
    const type: "user" | "group" = event.message_type === "group" ? "group" : "user";
    const scopeId: string | number = type === "group" ? event.group_id : event.user_id;

    // Get active character
    const characterId = await getActiveCharacterId();
    if (!characterId) {
        console.warn("[bot] no active character, skipping message");
        return;
    }

    // Ensure we have a conversation for this scope
    const conversationId = await resolveConversationId(characterId, type, scopeId);

    // Switch server to this conversation
    await selectConversation(characterId, conversationId);

    // Send message to server and get reply
    console.log(`[bot] chat: character=${characterId}, conversation=${conversationId}, prompt="${text}"`);
    const reply = await chat(characterId, conversationId, text);
    console.log(`[bot] reply: "${reply}"`);

    // Forward reply back to QQ
    if (type === "user") {
        sendAction("send_private_msg", {
            user_id: event.user_id,
            message: reply,
        });
    } else {
        sendAction("send_group_msg", {
            group_id: event.group_id,
            message: reply,
        });
    }
}

ws.on("open", () => {
    console.log("[bot] connected to NapCat OneBot");
});

ws.on("message", (data) => {
    let event: any;
    try {
        event = JSON.parse(data.toString());
    } catch {
        console.warn("[bot] failed to parse message:", data.toString());
        return;
    }

    if (event.post_type === "message") {
        handleMessage(event).catch((err) => {
            console.error("[bot] error handling message:", err);
        });
    }
});

ws.on("error", (err) => {
    console.error("[bot] websocket error:", err);
});

ws.on("close", () => {
    console.log("[bot] websocket closed");
});
