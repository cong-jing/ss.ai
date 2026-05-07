import { ApiDefine } from "../apiBase.js";

export interface ChatRequest {
    /** Which character to chat with. Defaults to the single configured character on the backend. */
    characterId?: string;
    prompt: string;
}

export interface ChatResponse {
    output: string;
    model: string;
    requestId: string;
}

export interface ChatStreamRequest {
    /** Which character to chat with. Defaults to the single configured character on the backend. */
    characterId?: string;
    prompt: string;
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

export interface ChatDryRunRequest {
    prompt: string;
}

export interface ChatDryRunMessage {
    role: "system" | "user" | "assistant";
    content: string;
}

export interface ChatDryRunResponse {
    messages: ChatDryRunMessage[];
}

/** Dry-run endpoint: assembles the prompt without sending to the LLM. */
export const ApiChatDryRun = new ApiDefine<ChatDryRunRequest, ChatDryRunResponse>("/v1/chat/dry-run", "POST");
