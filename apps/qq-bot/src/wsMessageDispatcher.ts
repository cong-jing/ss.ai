type DispatcherDeps = {
    handleIncomingMessage: (event: unknown) => Promise<void>;
    setBotSelfId: (id: string | number | null) => void;
    logInfo?: (...args: unknown[]) => void;
    logWarn?: (...args: unknown[]) => void;
    logError?: (...args: unknown[]) => void;
};

function toStringPayload(data: unknown): string {
    if (typeof data === "string") return data;
    if (Buffer.isBuffer(data)) return data.toString();
    if (data && typeof data === "object" && "toString" in data && typeof (data as { toString: unknown }).toString === "function") {
        return String((data as { toString: () => string }).toString());
    }
    return String(data);
}

export function createWsMessageDispatcher(deps: DispatcherDeps) {
    return (data: unknown): void => {
        let event: any;
        try {
            event = JSON.parse(toStringPayload(data));
        } catch {
            deps.logWarn?.("[bot] failed to parse message", { raw: toStringPayload(data) });
            return;
        }

        if (event.echo && typeof event.echo === "string" && event.echo.startsWith("echo-")) {
            if (event.data?.user_id != null) {
                deps.setBotSelfId(event.data.user_id);
                deps.logInfo?.("[bot] NapCat login info", {
                    selfId: event.data.user_id,
                    nickname: event.data.nickname ?? null,
                });
            }
        }

        if (event.post_type === "message") {
            deps.handleIncomingMessage(event).catch((err) => {
                deps.logError?.("[bot] error handling message", err);
            });
        }
    };
}
