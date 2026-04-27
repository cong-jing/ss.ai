import { ApiDefine } from "../apiBase";

export interface ChatRequest {
    prompt: string;
    sessionId?: string;
}

export interface ChatResponse {
    output: string;
    model: string;
    requestId: string;
}

export interface ChatStreamRequest {
    prompt: string;
    sessionId?: string;
}

/** SSE stream event — one per `data:` line */
export type ChatStreamEvent =
    | { type: "chunk"; content: string }
    | { type: "done"; requestId: string; model: string };

export const ApiChat = new ApiDefine<ChatRequest, ChatResponse>("/v1/chat", "POST");

/**
 * SSE streaming endpoint. Not used with callApi — use fetch + ReadableStream.
 * Exported so frontend and backend share the same URL / method.
 */
export const ApiChatStream = new ApiDefine<ChatStreamRequest, never>("/v1/chat/stream", "POST");
