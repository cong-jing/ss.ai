import type { TurnEvent } from "@ss-ai/contracts";

export function getTurnEventsReplyText(events: TurnEvent[]): string {
    return events
        .filter((event): event is Extract<TurnEvent, { type: "replyText" }> => event.type === "replyText")
        .map(event => event.text.trim())
        .filter(Boolean)
        .join("\n");
}
