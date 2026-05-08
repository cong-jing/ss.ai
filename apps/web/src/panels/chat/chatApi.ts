import { ApiChat, ApiChatDryRun, ApiChatStream, type ChatStreamEvent, type GetMessagesResponse } from "@ss-ai/contracts";
import { callApi } from "../../shared/api/httpClient";

export async function apiGetMessages(conversationId: string): Promise<GetMessagesResponse> {
    const res = await fetch(`/v1/conversations/${encodeURIComponent(conversationId)}/messages`);
    if (!res.ok) {
        const err = await res.json() as { message?: string };
        throw new Error(err.message ?? `Request failed: ${res.status}`);
    }
    return res.json() as Promise<GetMessagesResponse>;
}

export async function apiSendChatMessage(prompt: string) {
    return callApi(ApiChat, { prompt });
}

export async function apiDryRunChat(prompt: string) {
    return callApi(ApiChatDryRun, { prompt });
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
