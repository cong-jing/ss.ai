import { ApiChat, ApiChatDryRun, ApiChatStream, type ChatStreamEvent, type GetMessagesResponse, type LlmResponseMode, type InteractionMode, type TurnEvent } from "@ss-ai/contracts";
import { callApi } from "../../shared/api/httpClient";
import { throwApiRequestError } from "../../shared/api/throwApiRequestError";

export async function apiGetMessages(conversationId: string): Promise<GetMessagesResponse> {
    const res = await fetch(`/v1/conversations/${encodeURIComponent(conversationId)}/messages`, {
        credentials: "same-origin",
    });
    if (!res.ok) {
        await throwApiRequestError(res);
    }
    return res.json() as Promise<GetMessagesResponse>;
}

export async function apiDeleteMessage(conversationId: string, messageId: string): Promise<void> {
    const res = await fetch(`/v1/conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}`, {
        method: "DELETE",
        credentials: "same-origin",
    });
    if (!res.ok) {
        await throwApiRequestError(res);
    }
}

export async function apiSendChatMessage(
    characterId: string,
    conversationId: string,
    userMessageText: string,
    senderActorId?: string,
    llmResponseMode: LlmResponseMode = "structured",
    includeAssembledMessages = false,
    interactionMode?: InteractionMode,
) {
    return callApi(ApiChat, { characterId, conversationId, userMessageText, senderActorId, llmResponseMode, includeAssembledMessages, interactionMode });
}

export async function apiDryRunChat(
    characterId: string,
    conversationId: string,
    userMessageText: string,
    senderActorId?: string,
    llmResponseMode: LlmResponseMode = "structured",
    interactionMode?: InteractionMode,
) {
    return callApi(ApiChatDryRun, { characterId, conversationId, userMessageText, senderActorId, llmResponseMode, interactionMode });
}

export async function apiStreamChatMessage(
    characterId: string,
    conversationId: string,
    userMessageText: string,
    senderActorId: string | undefined,
    llmResponseMode: LlmResponseMode = "non-structured",
    onChunk: (content: string) => void,
    signal?: AbortSignal,
    includeAssembledMessages = false,
    onAssembledMessages?: (messages: { role: string; content: string }[]) => void,
    interactionMode?: InteractionMode
): Promise<{ requestId: string; model: string; apiKeySource: "user" | "default" | null; turnEvents?: TurnEvent[] }> {
    const response = await fetch(ApiChatStream.apiUrl, {
        method: ApiChatStream.method,
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ characterId, conversationId, userMessageText, senderActorId, llmResponseMode, interactionMode, includeAssembledMessages }),
        signal
    });

    if (!response.ok) {
        await throwApiRequestError(response);
    }
    if (!response.body) {
        throw new Error("Request succeeded but stream body is missing.");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let result: { requestId: string; model: string; apiKeySource: "user" | "default" | null; turnEvents?: TurnEvent[] } = {
        requestId: "",
        model: "",
        apiKeySource: null,
    };

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
                result = { requestId: event.requestId, model: event.model, apiKeySource: event.apiKeySource ?? null, turnEvents: event.turnEvents };
            } else if (event.type === "assembledMessages") {
                onAssembledMessages?.(event.messages);
            }
        }
    }

    return result;
}
