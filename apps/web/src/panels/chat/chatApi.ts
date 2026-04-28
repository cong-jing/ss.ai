import { ApiChat, ApiChatStream, type ChatStreamEvent } from "@ss-ai/contracts";
import { callApi } from "../../shared/api/httpClient";

export async function apiSendChatMessage(prompt: string, sessionId?: string) {
    return callApi(ApiChat, { prompt, sessionId });
}

export async function apiStreamChatMessage(
    prompt: string,
    onChunk: (content: string) => void,
    signal?: AbortSignal
): Promise<{ requestId: string; model: string }> {
    const response = await fetch(ApiChatStream.apiUrl, {
        method: ApiChatStream.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
        signal
    });

    if (!response.ok || !response.body) {
        const data = await response.json() as { message?: string };
        throw new Error(data.message ?? `Request failed: ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let result = { requestId: "", model: "" };

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const event = JSON.parse(line.slice(6)) as ChatStreamEvent;
            if (event.type === "chunk") {
                onChunk(event.content);
            } else if (event.type === "done") {
                result = { requestId: event.requestId, model: event.model };
            }
        }
    }

    return result;
}
