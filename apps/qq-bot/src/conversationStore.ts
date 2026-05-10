/**
 * Local persistence for QQ user/group → conversationId mapping.
 * Stored as a JSON file alongside the source.
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const STORE_PATH = resolve(__dirname, "../conversation-map.json");

type ConversationMap = Record<string, string>; // key: "user:<id>" | "group:<id>", value: conversationId

function load(): ConversationMap {
    if (!existsSync(STORE_PATH)) return {};
    try {
        return JSON.parse(readFileSync(STORE_PATH, "utf-8")) as ConversationMap;
    } catch {
        return {};
    }
}

function save(map: ConversationMap): void {
    writeFileSync(STORE_PATH, JSON.stringify(map, null, 2), "utf-8");
}

function makeKey(type: "user" | "group", id: string | number): string {
    return `${type}:${id}`;
}

/** Get the stored conversationId for a user or group, or undefined if not set. */
export function getConversationId(type: "user" | "group", id: string | number): string | undefined {
    const map = load();
    return map[makeKey(type, id)];
}

/** Store a conversationId for a user or group. */
export function setConversationId(type: "user" | "group", id: string | number, conversationId: string): void {
    const map = load();
    map[makeKey(type, id)] = conversationId;
    save(map);
}
