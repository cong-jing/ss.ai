import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createWsMessageDispatcher } from "../src/wsMessageDispatcher.js";

function waitForMicrotasks(): Promise<void> {
    return new Promise((resolve) => queueMicrotask(resolve));
}

describe("ws message dispatcher", () => {
    it("routes post_type=message into handleIncomingMessage", async () => {
        const handled: any[] = [];
        const dispatcher = createWsMessageDispatcher({
            handleIncomingMessage: async (event) => {
                handled.push(event);
            },
            setBotSelfId: () => undefined,
        });

        dispatcher(Buffer.from(JSON.stringify({ post_type: "message", user_id: 1, raw_message: "hi" })));
        await waitForMicrotasks();

        assert.equal(handled.length, 1);
        assert.equal(handled[0]?.raw_message, "hi");
    });

    it("updates self id from echo login info", () => {
        let selfId: string | number | null = null;
        const infoLogs: unknown[][] = [];
        const dispatcher = createWsMessageDispatcher({
            handleIncomingMessage: async () => undefined,
            setBotSelfId: (id) => {
                selfId = id;
            },
            logInfo: (...args) => {
                infoLogs.push(args);
            },
        });

        dispatcher(Buffer.from(JSON.stringify({
            echo: "echo-1",
            data: { user_id: 12345, nickname: "bot" },
        })));

        assert.equal(selfId, 12345);
        assert.equal(infoLogs.length, 1);
    });

    it("logs warning for invalid JSON payload", () => {
        const warnLogs: unknown[][] = [];
        const dispatcher = createWsMessageDispatcher({
            handleIncomingMessage: async () => undefined,
            setBotSelfId: () => undefined,
            logWarn: (...args) => {
                warnLogs.push(args);
            },
        });

        dispatcher({ toString: () => "not-json" });

        assert.equal(warnLogs.length, 1);
    });

    it("logs error when handleIncomingMessage rejects", async () => {
        const errorLogs: unknown[][] = [];
        const dispatcher = createWsMessageDispatcher({
            handleIncomingMessage: async () => {
                throw new Error("boom");
            },
            setBotSelfId: () => undefined,
            logError: (...args) => {
                errorLogs.push(args);
            },
        });

        dispatcher(Buffer.from(JSON.stringify({ post_type: "message", user_id: 1, raw_message: "hi" })));
        await waitForMicrotasks();

        assert.equal(errorLogs.length, 1);
    });
});
