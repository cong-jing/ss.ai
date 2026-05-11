/**
 * Local persistence for QQ bindings in a single JSON file.
 * Includes:
 * - user/group -> conversationId
 * - private/group-member -> actor binding (conversationId + actorId)
 *
 * Example file content:
 * {
 *   "conversations": {
 *     "user:123456": "conv-private-001",
 *     "group:987654": "conv-group-010"
 *   },
 *   "privateActorBindings": {
 *     "private:123456": {
 *       "conversationId": "conv-private-001",
 *       "actorId": "actor-private-abc",
 *       "updatedAt": "2026-05-11T10:20:30.000Z"
 *     }
 *   },
 *   "groupMemberActorBindings": {
 *     "group:987654:123456": {
 *       "conversationId": "conv-group-010",
 *       "actorId": "actor-group-u123456",
 *       "updatedAt": "2026-05-11T10:21:00.000Z"
 *     }
 *   }
 * }
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync } from "fs";
import { dirname } from "path";

let storePath = "./user-data-dev/qq-bot/conversation-map.json";

type ActorBinding = {
    conversationId: string;
    actorId: string;
    updatedAt: string;
};

type StoreData = {
    conversations: Record<string, string>;
    privateActorBindings: Record<string, ActorBinding>;
    groupMemberActorBindings: Record<string, ActorBinding>;
};

export function configureConversationStore(path: string): void {
    storePath = path;
}

function createEmptyStore(): StoreData {
    return {
        conversations: {},
        privateActorBindings: {},
        groupMemberActorBindings: {},
    };
}

function isLegacyConversationMap(input: unknown): input is Record<string, string> {
    if (!input || typeof input !== "object" || Array.isArray(input)) return false;
    return Object.values(input).every(value => typeof value === "string");
}

function load(): StoreData {
    if (!existsSync(storePath)) return createEmptyStore();
    try {
        const parsed = JSON.parse(readFileSync(storePath, "utf-8")) as unknown;
        if (isLegacyConversationMap(parsed)) {
            return {
                ...createEmptyStore(),
                conversations: parsed,
            };
        }

        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            const data = parsed as Partial<StoreData>;
            return {
                conversations: data.conversations ?? {},
                privateActorBindings: data.privateActorBindings ?? {},
                groupMemberActorBindings: data.groupMemberActorBindings ?? {},
            };
        }
        return createEmptyStore();
    } catch {
        return createEmptyStore();
    }
}

function save(data: StoreData): void {
    mkdirSync(dirname(storePath), { recursive: true });
    writeFileSync(storePath, JSON.stringify(data, null, 2), "utf-8");
}

function makeKey(type: "user" | "group", id: string | number): string {
    return `${type}:${id}`;
}

function privateKey(userId: string | number): string {
    return `private:${userId}`;
}

function groupMemberKey(groupId: string | number, userId: string | number): string {
    return `group:${groupId}:${userId}`;
}

/** Get the stored conversationId for a user or group, or undefined if not set. */
export function getConversationId(type: "user" | "group", id: string | number): string | undefined {
    const data = load();
    return data.conversations[makeKey(type, id)];
}

/** Store a conversationId for a user or group. */
export function setConversationId(type: "user" | "group", id: string | number, conversationId: string): void {
    const data = load();
    data.conversations[makeKey(type, id)] = conversationId;
    save(data);
}

export function getPrivateActorBinding(userId: string | number): ActorBinding | undefined {
    const data = load();
    return data.privateActorBindings[privateKey(userId)];
}

export function setPrivateActorBinding(
    userId: string | number,
    binding: { conversationId: string; actorId: string },
): void {
    const data = load();
    data.privateActorBindings[privateKey(userId)] = {
        ...binding,
        updatedAt: new Date().toISOString(),
    };
    save(data);
}

export function getGroupMemberActorBinding(
    groupId: string | number,
    userId: string | number,
): ActorBinding | undefined {
    const data = load();
    return data.groupMemberActorBindings[groupMemberKey(groupId, userId)];
}

export function setGroupMemberActorBinding(
    groupId: string | number,
    userId: string | number,
    binding: { conversationId: string; actorId: string },
): void {
    const data = load();
    data.groupMemberActorBindings[groupMemberKey(groupId, userId)] = {
        ...binding,
        updatedAt: new Date().toISOString(),
    };
    save(data);
}
