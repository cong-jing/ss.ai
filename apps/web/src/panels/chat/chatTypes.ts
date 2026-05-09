export type ChatRole = "user" | "assistant" | "system" | "debug";

export interface DebugMessage {
    role: string;
    content: string;
}

export interface ChatMessage {
    id: string;
    role: ChatRole;
    content: string;
    createdAt?: string;
    status?: "normal" | "streaming" | "failed";
    debugMessages?: DebugMessage[];
    /** Assembled prompt messages attached when sent with includePrompt=true */
    promptMessages?: DebugMessage[];
}
