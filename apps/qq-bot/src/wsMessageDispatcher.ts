type WsMessageDispatcherDeps = {
    handleIncomingMessage: (event: any) => Promise<void>;
    setBotSelfId: (id: string | number) => void;
    logInfo?: (...args: unknown[]) => void;
    logWarn?: (...args: unknown[]) => void;
    logError?: (...args: unknown[]) => void;
};

export function createWsMessageDispatcher(deps: WsMessageDispatcherDeps) {
    return (data: { toString(): string }): void => {
        let event: any;
        try {
            event = JSON.parse(data.toString());
        } catch {
            deps.logWarn?.("[bot] failed to parse message:", data.toString());
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
                deps.logError?.("[bot] error handling message:", err);
            });
        }
    };
}
