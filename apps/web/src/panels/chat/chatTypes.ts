import type { ChatStructuredOutput } from "@ss-ai/contracts";

export type ChatRole = "user" | "assistant" | "system" | "debug";

export interface DebugMessage {
    role: string;
    content: string;
}

export interface ChatMessage {
    id?: string;
    role: ChatRole;
    senderActorId?: string;
    senderDisplayName?: string;
    senderSourceType?: "ai_character" | "system" | "logged_user" | "local_actor";
    content: string;
    createdAt?: string;
    status?: "normal" | "streaming" | "failed";
    debugMessages?: DebugMessage[];
    /** Assembled LLM input messages attached when sent with includeAssembledMessages=true */
    assembledMessages?: DebugMessage[];
    structuredOutput?: ChatStructuredOutput;
    deleting?: boolean;
}
