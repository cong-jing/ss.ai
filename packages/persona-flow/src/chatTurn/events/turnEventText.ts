import type { TurnEvent } from "@ss-ai/contracts";

export function getTurnEventsReplyText(events: TurnEvent[]): string {
    return events
        .filter((event): event is Extract<TurnEvent, { type: "replyText" }> => event.type === "replyText")
        .map(event => event.text.trim())
        .filter(Boolean)
        .join("\n");
}

/**
 * Merge consecutive `replyText` events that share the same `characterId`
 * into a single `replyText` event whose text joins the originals with
 * `\n`. Non-`replyText` events between two reply texts break the run and
 * are preserved in place, so expression / sceneAtmosphere / stateUpdate
 * inserted between paragraphs still split the spoken text.
 *
 * Streaming providers tend to emit one `replyText` per paragraph while
 * non-stream calls usually return a single block; this helper normalizes
 * both shapes into the same canonical `events` list so persistence,
 * prompt history, and UI all see one logical reply per uninterrupted
 * speaking turn.
 */
export function mergeConsecutiveReplyTextEvents(events: TurnEvent[]): TurnEvent[] {
    const merged: TurnEvent[] = [];
    for (const event of events) {
        const last = merged[merged.length - 1];
        if (
            event.type === "replyText" &&
            last?.type === "replyText" &&
            last.characterId === event.characterId
        ) {
            merged[merged.length - 1] = {
                ...last,
                text: `${last.text}\n${event.text}`,
            };
        } else {
            merged.push(event);
        }
    }
    return merged;
}
