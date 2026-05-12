export type ChatRole = "user" | "assistant" | "system" | "debug";

export interface DebugMessage {
    role: string;
    content: string;
}

export interface StructuredDecisionPayload {
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
    /** Assembled prompt messages attached when sent with includePrompt=true */
    promptMessages?: DebugMessage[];
    structuredDecision?: StructuredDecisionPayload;
    deleting?: boolean;
}
