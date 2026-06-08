import { ApiChat, ApiChatDryRun, ApiChatStream, type ChatStreamEvent, type GetMessagesResponse, type InteractionMode, type TurnEvent } from "@ss-ai/contracts";
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
    includeAssembledMessages = false,
    interactionMode?: InteractionMode,
) {
    return callApi(ApiChat, { characterId, conversationId, userMessageText, senderActorId, includeAssembledMessages, interactionMode });
}

export async function apiDryRunChat(
    characterId: string,
    conversationId: string,
    userMessageText: string,
    senderActorId?: string,
    interactionMode?: InteractionMode,
) {
    return callApi(ApiChatDryRun, { characterId, conversationId, userMessageText, senderActorId, interactionMode });
}

export interface StreamChatResult {
    requestId: string;
    model: string;
    apiKeySource: "user" | "default" | null;
    output?: string;
    userMessageId?: string;
    assistantMessageId?: string;
    turnEvents?: TurnEvent[];
    streamCompleted?: boolean;
    streamFinishReason?: string;
}

export interface StreamChatCallbacks {
    onChunk: (content: string) => void;
    onAssembledMessages?: (messages: { role: string; content: string }[]) => void;
    onTurnEventPreview?: (preview: { eventIndex: number; event: TurnEvent }) => void;
}

export async function apiStreamChatMessage(
    characterId: string,
    conversationId: string,
    userMessageText: string,
    senderActorId: string | undefined,
    callbacks: StreamChatCallbacks,
    signal?: AbortSignal,
    includeAssembledMessages = false,
    interactionMode?: InteractionMode
): Promise<StreamChatResult> {
    const response = await fetch(ApiChatStream.apiUrl, {
        method: ApiChatStream.method,
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ characterId, conversationId, userMessageText, senderActorId, interactionMode, includeAssembledMessages }),
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
    let result: StreamChatResult = {
        requestId: "",
        model: "",
        apiKeySource: null,
    };
    let streamErrorMessage: string | null = null;

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
                callbacks.onChunk(event.content);
            } else if (event.type === "turnEventPreview") {
                callbacks.onTurnEventPreview?.({ eventIndex: event.eventIndex, event: event.event });
            } else if (event.type === "assembledMessages") {
                callbacks.onAssembledMessages?.(event.messages);
            } else if (event.type === "done") {
                result = {
                    requestId: event.requestId,
                    model: event.model,
                    apiKeySource: event.apiKeySource ?? null,
                    output: event.output,
                    userMessageId: event.userMessageId,
                    assistantMessageId: event.assistantMessageId,
                    turnEvents: event.turnEvents,
                    streamCompleted: event.streamCompleted,
                    streamFinishReason: event.streamFinishReason,
                };
            } else if (event.type === "error") {
                streamErrorMessage = event.message;
            }
        }
    }

    if (streamErrorMessage) {
        throw new Error(streamErrorMessage);
    }

    return result;
}
