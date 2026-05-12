import { ApiDefine } from "../apiBase.js";

export type ChatMode = "non-structured" | "structured";

export interface ChatRequest {
    /** Character to chat with. */
    characterId: string;
    /** Conversation to continue. Must belong to characterId. */
    conversationId: string;
    /** Optional sender actor for this user message. */
    speakerActorId?: string;
    prompt: string;
    /** Generation mode. Defaults to `structured` when omitted. */
    mode?: ChatMode;
    /** When true, the response will include the assembled prompt messages for debugging. */
    includePrompt?: boolean;
}

export interface ChatResponse {
    output: string;
    model: string;
    requestId: string;
    /** ID of the appended user message. */
    userMessageId: string;
    /** ID of the appended assistant message. Undefined when this turn is skipped. */
    assistantMessageId?: string;
    /** Structured decision payload from non-structured/structured dual-mode pipeline. */
    structuredOutput?: ChatStructuredOutput;
    /** Assembled prompt messages, only present when request included `includePrompt: true`. */
    promptMessages?: ChatDryRunMessage[];
}

export interface ChatStructuredOutput {
    action: "reply" | "skip";
    replyText: string;
    control: {
        summarizeSuggested: boolean;
        summarizeReason: string;
        summarizeUrgency: "none" | "low" | "normal" | "high";
    };
    skip: {
        reasonCode:
        | "none"
        | "not_addressed"
        | "low_value"
        | "rate_control"
        | "character_busy"
        | "waiting_for_others"
        | "other";
        reason: string;
    };
}

export interface ChatStreamRequest {
    /** Character to chat with. */
    characterId: string;
    /** Conversation to continue. Must belong to characterId. */
    conversationId: string;
    /** Optional sender actor for this user message. */
    speakerActorId?: string;
    prompt: string;
    /** Generation mode for stream endpoint. Defaults to `non-structured` when omitted. */
    mode?: ChatMode;
    /** When true, a `prompt` SSE event is sent first with the assembled prompt messages. */
    includePrompt?: boolean;
}

/** SSE stream event — one per `data:` line */
export type ChatStreamEvent =
    | { type: "chunk"; content: string }
    | { type: "done"; requestId: string; model: string }
    | { type: "prompt"; messages: ChatDryRunMessage[] };

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
    speakerActorId?: string;
    prompt: string;
    /** Prompt rendering mode. Defaults to `structured` when omitted. */
    mode?: ChatMode;
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
