import { ApiDefine } from "../apiBase.js";
import type { InteractionMode } from "../interactionMode.js";

export type LlmResponseMode = "non-structured" | "structured";

export interface ChatRequest {
    /** Character to chat with. */
    characterId: string;
    /** Conversation to continue. Must belong to characterId. */
    conversationId: string;
    /** Optional sender actor for this user message. */
    senderActorId?: string;
    userMessageText: string;
    /** LLM response mode. Defaults to `structured` when omitted. */
    llmResponseMode?: LlmResponseMode;
    /** Interaction mode for prompt assembly. Defaults to `single_character_chat` when omitted. */
    interactionMode?: InteractionMode;
    /** When true, the response will include assembled LLM input messages for debugging. */
    includeAssembledMessages?: boolean;
}

export interface ChatResponse {
    output: string;
    model: string;
    requestId: string;
    apiKeySource: "user" | "default";
    /** ID of the appended user message. */
    userMessageId: string;
    /** ID of the appended assistant message. Undefined when no assistant message was appended. */
    assistantMessageId?: string;
    /** Structured payload returned by the chat model call. */
    structuredOutput?: ChatStructuredOutput;
    /** Assembled LLM input messages, only present when request included `includeAssembledMessages: true`. */
    assembledMessages?: ChatDryRunMessage[];
}

export interface ChatStructuredOutput {
    replyText: string;
}

export interface ChatStreamRequest {
    /** Character to chat with. */
    characterId: string;
    /** Conversation to continue. Must belong to characterId. */
    conversationId: string;
    /** Optional sender actor for this user message. */
    senderActorId?: string;
    userMessageText: string;
    /** LLM response mode for stream endpoint. Defaults to `non-structured` when omitted. */
    llmResponseMode?: LlmResponseMode;
    /** Interaction mode for prompt assembly. Defaults to `single_character_chat` when omitted. */
    interactionMode?: InteractionMode;
    /** When true, an `assembledMessages` SSE event is sent first with assembled LLM input messages. */
    includeAssembledMessages?: boolean;
}

/** SSE stream event — one per `data:` line */
export type ChatStreamEvent =
    | { type: "chunk"; content: string }
    | { type: "done"; requestId: string; model: string; apiKeySource: "user" | "default" }
    | { type: "assembledMessages"; messages: ChatDryRunMessage[] };

export const ApiChat = new ApiDefine<ChatRequest, ChatResponse>("/v1/chat", "POST");

/**
 * SSE streaming endpoint. Not used with callApi — use fetch + ReadableStream.
 * Exported so frontend and backend share the same URL / method.
 */
export const ApiChatStream = new ApiDefine<ChatStreamRequest, never>("/v1/chat/stream", "POST");

export interface ChatDryRunRequest {
    /** Character used to build prompt context. */
    characterId: string;
    /** Conversation used to build prompt context. Must belong to characterId. */
    conversationId: string;
    /** Optional sender actor for this user message. */
    senderActorId?: string;
    userMessageText: string;
    /** LLM response mode for prompt assembly. Defaults to `structured` when omitted. */
    llmResponseMode?: LlmResponseMode;
    /** Interaction mode for prompt assembly. Defaults to `single_character_chat` when omitted. */
    interactionMode?: InteractionMode;
}

export interface ChatDryRunMessage {
    role: "system" | "user" | "assistant";
    content: string;
}

export interface ChatDryRunResponse {
    messages: ChatDryRunMessage[];
}

/** Dry-run endpoint: assembles LLM input messages without sending to the LLM. */
export const ApiChatDryRun = new ApiDefine<ChatDryRunRequest, ChatDryRunResponse>("/v1/chat/dry-run", "POST");
