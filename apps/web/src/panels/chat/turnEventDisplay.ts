import type { TurnEvent } from "@ss-ai/contracts";
import type { ChatDisplaySegment, ChatMarkerType } from "./chatTypes";

type MarkerSourceEvent = Extract<TurnEvent, { type: "expression" | "sceneAtmosphere" | "stateUpdate" }>;

/**
 * Marker types we render inline in the chat bubble. `stateUpdate` is
 * deliberately excluded because it tends to be noisy and is already
 * available in the per-turn debug panel.
 */
const INLINE_MARKER_TYPES: ReadonlySet<ChatMarkerType> = new Set(["expression", "sceneAtmosphere"]);

export function isInlineMarkerEvent(event: TurnEvent): event is MarkerSourceEvent {
    return event.type !== "replyText" && INLINE_MARKER_TYPES.has(event.type as ChatMarkerType);
}

export function eventToMarkerSegment(event: MarkerSourceEvent): ChatDisplaySegment {
    switch (event.type) {
        case "expression": {
            const label = event.intensity !== undefined
                ? `${event.expression} (${event.intensity})`
                : event.expression;
            return { kind: "marker", markerType: "expression", label };
        }
        case "sceneAtmosphere": {
            return {
                kind: "marker",
                markerType: "sceneAtmosphere",
                label: event.atmosphere,
                ...(event.note ? { detail: event.note } : {}),
            };
        }
        case "stateUpdate": {
            return {
                kind: "marker",
                markerType: "stateUpdate",
                label: "state",
                detail: JSON.stringify(event.update),
            };
        }
    }
}

/**
 * Build interleaved display segments from a canonical `TurnEvent[]`.
 * Used for non-stream replies, history loads, and the final "snap" after
 * a stream completes. Consecutive `replyText` events are joined with `\n`
 * to match the persisted display text shape produced by the backend.
 */
export function buildSegmentsFromTurnEvents(turnEvents: TurnEvent[] | undefined): ChatDisplaySegment[] {
    if (!turnEvents?.length) return [];
    const segments: ChatDisplaySegment[] = [];
    for (const event of turnEvents) {
        if (event.type === "replyText") {
            if (!event.text) continue;
            const last = segments[segments.length - 1];
            if (last?.kind === "text") {
                last.text = `${last.text}\n${event.text}`;
            } else {
                segments.push({ kind: "text", text: event.text });
            }
            continue;
        }
        if (isInlineMarkerEvent(event)) {
            segments.push(eventToMarkerSegment(event));
        }
    }
    return segments;
}

/**
 * Append a streamed text fragment to the trailing text segment, creating
 * one when the previous segment is a marker (or when the list is empty).
 */
export function appendTextDeltaToSegments(segments: ChatDisplaySegment[], delta: string): void {
    if (!delta) return;
    const last = segments[segments.length - 1];
    if (last?.kind === "text") {
        last.text = last.text + delta;
    } else {
        segments.push({ kind: "text", text: delta });
    }
}
