import type { TurnEvent } from "@ss-ai/contracts";

export type ChatRole = "user" | "assistant" | "system" | "debug";

export interface DebugMessage {
    role: string;
    content: string;
}

export type ChatMarkerType = "expression" | "sceneAtmosphere" | "stateUpdate";

/**
 * Renderable segment of an assistant message bubble. The view layer walks
 * `displaySegments` to draw a mixed flow of reply text and inline markers
 * (e.g. expression / sceneAtmosphere chips) in the same order the model
 * emitted them.
 */
export type ChatDisplaySegment =
    | { kind: "text"; text: string }
    | {
        kind: "marker";
        markerType: ChatMarkerType;
        label: string;
        detail?: string;
    };

export interface ChatMessage {
    id?: string;
    role: ChatRole;
    senderActorId?: string;
    senderDisplayName?: string;
    senderSourceType?: "ai_character" | "system" | "logged_user" | "local_actor";
    content: string;
    /**
     * Optional interleaved render plan for assistant messages. When set
     * the bubble renders these segments instead of plain `content`,
     * letting non-text turn events appear inline as small chips.
     */
    displaySegments?: ChatDisplaySegment[];
    createdAt?: string;
    status?: "normal" | "streaming" | "failed";
    debugMessages?: DebugMessage[];
    turnEvents?: TurnEvent[];
    deleting?: boolean;
}
