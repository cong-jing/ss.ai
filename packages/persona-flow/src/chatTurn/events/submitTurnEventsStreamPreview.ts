import {
    TurnEventSchema,
    type TurnEvent,
} from "@ss-ai/contracts/turnEvents.schema";

/**
 * Streaming JSON preview for `submit_turn_events` style arguments.
 *
 * The model emits its final result as an incremental JSON string —
 * either as the text channel of a `response_format: json_schema`
 * structured output, or as fragmented `arguments` of a tool call.
 * This parser is fed those fragments and produces best-effort,
 * application level preview events:
 *
 * - `replyTextDelta`: incremental, JSON-escape-decoded characters from a
 *   `replyText.text` value that we can already safely show.
 * - `turnEventPreview`: a completed `events[n]` object that already passes
 *   {@link TurnEventSchema} validation. Useful for previewing non-text events
 *   such as expression / sceneAtmosphere as soon as their object closes.
 *
 * The parser is deliberately tolerant: bad JSON or schema-invalid event
 * objects stop further preview emission but never throw. The final
 * authoritative result is always produced by `parseSubmitTurnEventsArgs`
 * over the fully assembled JSON string or parsed object.
 */
export type SubmitTurnEventsPreviewEvent =
    | {
        type: "replyTextDelta";
        eventIndex: number;
        text: string;
    }
    | {
        type: "turnEventPreview";
        eventIndex: number;
        event: TurnEvent;
    };

export type SubmitTurnEventsTurnEventPreview = Extract<
    SubmitTurnEventsPreviewEvent,
    { type: "turnEventPreview" }
>;

export interface SubmitTurnEventsStreamPreviewParser {
    /**
     * Feed a new fragment of the streaming JSON arguments. Returns the
     * preview events that become available given the new data.
     */
    push(delta: string): SubmitTurnEventsPreviewEvent[];

    /** Get the merged arguments string seen so far. */
    getBufferedArguments(): string;
}

export function createSubmitTurnEventsPreviewParser(): SubmitTurnEventsStreamPreviewParser {
    return new SubmitTurnEventsStreamPreviewParserImpl();
}

type ObjectFrame = {
    kind: "object";
    state:
    | "expect_first_key_or_end"
    | "expect_key"
    | "expect_colon"
    | "expect_value"
    | "expect_comma_or_end";
    currentKey?: string;
    role: "root" | "event" | "other";
    /** Populated when role === "event". */
    eventIndex?: number;
    /** Populated when role === "event"; absolute index in `buffer` of the `{`. */
    sourceStartIndex?: number;
    /** Populated when role === "event" and the JSON "type" key has been parsed. */
    knownType?: string;
};

type ArrayFrame = {
    kind: "array";
    state: "expect_first_value_or_end" | "expect_value" | "expect_comma_or_end";
    nextIndex: number;
    role: "events" | "other";
};

type StringFrame = {
    kind: "string";
    decoded: string;
    pendingEscape: boolean;
    pendingUnicode: string; // accumulated hex digits when inside \uXXXX
    inUnicode: boolean;
    emittedLen: number;
    mode: "key" | "value";
    role: "reply_text_value" | "other";
    /** Set when role === "reply_text_value". */
    replyTextEventIndex?: number;
};

type NumberFrame = { kind: "number"; raw: string };
type LiteralFrame = { kind: "literal"; raw: string; target: "true" | "false" | "null" };

type Frame = ObjectFrame | ArrayFrame | StringFrame | NumberFrame | LiteralFrame;

function isWhitespace(ch: string): boolean {
    return ch === " " || ch === "\t" || ch === "\n" || ch === "\r";
}

function isHexDigit(ch: string): boolean {
    return (
        (ch >= "0" && ch <= "9")
        || (ch >= "a" && ch <= "f")
        || (ch >= "A" && ch <= "F")
    );
}

function isNumberStart(ch: string): boolean {
    return ch === "-" || (ch >= "0" && ch <= "9");
}

function isNumberBody(ch: string): boolean {
    return (
        (ch >= "0" && ch <= "9")
        || ch === "."
        || ch === "e"
        || ch === "E"
        || ch === "+"
        || ch === "-"
    );
}

class SubmitTurnEventsStreamPreviewParserImpl implements SubmitTurnEventsStreamPreviewParser {
    private buffer = "";
    private pos = 0;
    private stack: Frame[] = [];
    private rootStarted = false;
    private rootEnded = false;
    private failed = false;

    push(delta: string): SubmitTurnEventsPreviewEvent[] {
        if (this.failed || this.rootEnded) return [];
        if (!delta) return [];
        this.buffer += delta;
        const out: SubmitTurnEventsPreviewEvent[] = [];

        try {
            // Loop until we either run out of input or hit a state that needs
            // more characters (advance returns false).
            while (
                this.pos < this.buffer.length
                && !this.failed
                && !this.rootEnded
                && this.step(out)
            ) {
                // continue
            }
        } catch (_err) {
            // Any unexpected parser error means we stop emitting previews.
            // The authoritative parser still runs on the final arguments string.
            this.failed = true;
        }

        return out;
    }

    getBufferedArguments(): string {
        return this.buffer;
    }

    private step(out: SubmitTurnEventsPreviewEvent[]): boolean {
        const advanced = this.stepCore(out);
        this.drainPendingPreviewEmits(out);
        return advanced;
    }

    private stepCore(out: SubmitTurnEventsPreviewEvent[]): boolean {
        const top = this.stack[this.stack.length - 1];
        if (top?.kind === "string") {
            return this.stepInString(top, out);
        }
        if (top?.kind === "number") {
            return this.stepInNumber(top);
        }
        if (top?.kind === "literal") {
            return this.stepInLiteral(top);
        }

        const ch = this.buffer[this.pos];
        if (isWhitespace(ch)) {
            this.pos++;
            return true;
        }

        if (!this.rootStarted) {
            if (ch !== "{") {
                this.failed = true;
                return false;
            }
            this.pushRootObject();
            this.pos++;
            return true;
        }

        if (top?.kind === "object") {
            return this.stepInObject(top);
        }
        if (top?.kind === "array") {
            return this.stepInArray(top);
        }

        // Should not be reachable: stack empty after root started.
        this.failed = true;
        return false;
    }

    private pushRootObject(): void {
        const root: ObjectFrame = {
            kind: "object",
            state: "expect_first_key_or_end",
            role: "root",
        };
        this.stack.push(root);
        this.rootStarted = true;
    }

    private stepInObject(frame: ObjectFrame): boolean {
        const ch = this.buffer[this.pos];

        switch (frame.state) {
            case "expect_first_key_or_end":
                if (ch === "}") {
                    this.closeContainer();
                    this.pos++;
                    return true;
                }
                if (ch === "\"") {
                    this.startString("key", "other");
                    this.pos++;
                    return true;
                }
                this.failed = true;
                return false;
            case "expect_key":
                if (ch === "\"") {
                    this.startString("key", "other");
                    this.pos++;
                    return true;
                }
                this.failed = true;
                return false;
            case "expect_colon":
                if (ch === ":") {
                    frame.state = "expect_value";
                    this.pos++;
                    return true;
                }
                this.failed = true;
                return false;
            case "expect_value":
                return this.startValue(frame);
            case "expect_comma_or_end":
                if (ch === ",") {
                    frame.state = "expect_key";
                    this.pos++;
                    return true;
                }
                if (ch === "}") {
                    this.closeContainer();
                    this.pos++;
                    return true;
                }
                this.failed = true;
                return false;
        }
    }

    private stepInArray(frame: ArrayFrame): boolean {
        const ch = this.buffer[this.pos];

        switch (frame.state) {
            case "expect_first_value_or_end":
                if (ch === "]") {
                    this.closeContainer();
                    this.pos++;
                    return true;
                }
                return this.startValue(frame);
            case "expect_value":
                return this.startValue(frame);
            case "expect_comma_or_end":
                if (ch === ",") {
                    frame.state = "expect_value";
                    this.pos++;
                    return true;
                }
                if (ch === "]") {
                    this.closeContainer();
                    this.pos++;
                    return true;
                }
                this.failed = true;
                return false;
        }
    }

    /**
     * Called when we have a parent object/array ready to accept a value and the
     * current character should start that value.
     */
    private startValue(parent: ObjectFrame | ArrayFrame): boolean {
        const ch = this.buffer[this.pos];

        // Determine value role based on parent.
        const valueRole = this.resolveValueRole(parent);

        if (ch === "{") {
            const eventCtx = valueRole === "event"
                ? {
                    role: "event" as const,
                    eventIndex: (parent as ArrayFrame).nextIndex,
                    sourceStartIndex: this.pos,
                }
                : { role: "other" as const };
            const child: ObjectFrame = {
                kind: "object",
                state: "expect_first_key_or_end",
                ...eventCtx,
            };
            this.stack.push(child);
            this.pos++;
            return true;
        }
        if (ch === "[") {
            const role = valueRole === "events_array" ? "events" : "other";
            const child: ArrayFrame = {
                kind: "array",
                state: "expect_first_value_or_end",
                nextIndex: 0,
                role,
            };
            this.stack.push(child);
            this.pos++;
            return true;
        }
        if (ch === "\"") {
            const role = valueRole === "reply_text_value" ? "reply_text_value" : "other";
            const stringFrame = this.startString("value", role);
            if (role === "reply_text_value") {
                stringFrame.replyTextEventIndex = (parent as ObjectFrame).eventIndex;
            }
            this.pos++;
            return true;
        }
        if (isNumberStart(ch)) {
            const child: NumberFrame = { kind: "number", raw: ch };
            this.stack.push(child);
            this.pos++;
            return true;
        }
        if (ch === "t" || ch === "f" || ch === "n") {
            const target: "true" | "false" | "null" = ch === "t" ? "true" : ch === "f" ? "false" : "null";
            const child: LiteralFrame = { kind: "literal", raw: ch, target };
            this.stack.push(child);
            this.pos++;
            return true;
        }
        this.failed = true;
        return false;
    }

    /** Compute what role the upcoming value plays in our schema-specific path tracking. */
    private resolveValueRole(parent: ObjectFrame | ArrayFrame):
        | "events_array"
        | "event"
        | "reply_text_value"
        | "other" {
        if (parent.kind === "object") {
            if (parent.role === "root" && parent.currentKey === "events") return "events_array";
            if (
                parent.role === "event"
                && parent.currentKey === "text"
                && parent.knownType === "replyText"
            ) {
                return "reply_text_value";
            }
            return "other";
        }
        // array
        if (parent.role === "events") return "event";
        return "other";
    }

    private startString(mode: "key" | "value", role: "reply_text_value" | "other"): StringFrame {
        const frame: StringFrame = {
            kind: "string",
            decoded: "",
            pendingEscape: false,
            pendingUnicode: "",
            inUnicode: false,
            emittedLen: 0,
            mode,
            role,
        };
        this.stack.push(frame);
        return frame;
    }

    private stepInString(frame: StringFrame, out: SubmitTurnEventsPreviewEvent[]): boolean {
        if (this.pos >= this.buffer.length) return false;
        const ch = this.buffer[this.pos];

        if (frame.inUnicode) {
            if (!isHexDigit(ch)) {
                this.failed = true;
                return false;
            }
            frame.pendingUnicode += ch;
            this.pos++;
            if (frame.pendingUnicode.length === 4) {
                const codePoint = parseInt(frame.pendingUnicode, 16);
                frame.decoded += String.fromCharCode(codePoint);
                frame.pendingUnicode = "";
                frame.inUnicode = false;
                this.maybeEmitReplyTextDelta(frame, out);
            }
            return true;
        }

        if (frame.pendingEscape) {
            const decoded = decodeJsonEscape(ch);
            if (decoded === null && ch !== "u") {
                this.failed = true;
                return false;
            }
            if (ch === "u") {
                frame.pendingEscape = false;
                frame.inUnicode = true;
                frame.pendingUnicode = "";
                this.pos++;
                return true;
            }
            frame.decoded += decoded;
            frame.pendingEscape = false;
            this.pos++;
            this.maybeEmitReplyTextDelta(frame, out);
            return true;
        }

        if (ch === "\\") {
            frame.pendingEscape = true;
            this.pos++;
            return true;
        }

        if (ch === "\"") {
            // End of string.
            this.pos++;
            this.closeStringFrame(frame, out);
            return true;
        }

        // Reject raw control characters; tolerate as failure.
        if (ch.charCodeAt(0) < 0x20) {
            this.failed = true;
            return false;
        }

        frame.decoded += ch;
        this.pos++;
        this.maybeEmitReplyTextDelta(frame, out);
        return true;
    }

    private maybeEmitReplyTextDelta(frame: StringFrame, out: SubmitTurnEventsPreviewEvent[]): void {
        if (frame.role !== "reply_text_value") return;
        if (frame.replyTextEventIndex === undefined) return;
        if (frame.decoded.length <= frame.emittedLen) return;

        const newText = frame.decoded.slice(frame.emittedLen);
        frame.emittedLen = frame.decoded.length;
        out.push({
            type: "replyTextDelta",
            eventIndex: frame.replyTextEventIndex,
            text: newText,
        });
    }

    private closeStringFrame(frame: StringFrame, out: SubmitTurnEventsPreviewEvent[]): void {
        this.stack.pop();
        const parent = this.stack[this.stack.length - 1];

        if (frame.mode === "key" && parent?.kind === "object") {
            parent.currentKey = frame.decoded;
            parent.state = "expect_colon";
            return;
        }

        // value path: notify parent
        if (parent?.kind === "object") {
            // If this string value was the `type` field of an event object,
            // record knownType so subsequent text values can be classified.
            if (parent.role === "event" && parent.currentKey === "type") {
                parent.knownType = frame.decoded;
            }
            parent.state = "expect_comma_or_end";
            return;
        }
        if (parent?.kind === "array") {
            parent.nextIndex += 1;
            parent.state = "expect_comma_or_end";
            return;
        }
        // No parent — root is a string? Not in our schema, but mark done.
        this.rootEnded = true;
        // Cast to ensure out is referenced even if no preview emitted.
        void out;
    }

    private stepInNumber(frame: NumberFrame): boolean {
        if (this.pos >= this.buffer.length) return false;
        const ch = this.buffer[this.pos];
        if (isNumberBody(ch)) {
            frame.raw += ch;
            this.pos++;
            return true;
        }
        // Number ends.
        this.stack.pop();
        this.afterScalarValue();
        return true;
    }

    private stepInLiteral(frame: LiteralFrame): boolean {
        if (this.pos >= this.buffer.length) return false;
        const ch = this.buffer[this.pos];
        const nextLen = frame.raw.length + 1;
        if (nextLen <= frame.target.length && frame.target[frame.raw.length] === ch) {
            frame.raw += ch;
            this.pos++;
            if (frame.raw === frame.target) {
                this.stack.pop();
                this.afterScalarValue();
            }
            return true;
        }
        this.failed = true;
        return false;
    }

    private afterScalarValue(): void {
        const parent = this.stack[this.stack.length - 1];
        if (parent?.kind === "object") {
            parent.state = "expect_comma_or_end";
            return;
        }
        if (parent?.kind === "array") {
            parent.nextIndex += 1;
            parent.state = "expect_comma_or_end";
        }
    }

    private closeContainer(): void {
        const frame = this.stack.pop();
        if (!frame) {
            this.failed = true;
            return;
        }

        // If we just closed an event object, attempt to emit a preview.
        if (frame.kind === "object" && frame.role === "event" && frame.sourceStartIndex !== undefined) {
            this.tryEmitEventPreview(frame);
        }

        const parent = this.stack[this.stack.length - 1];
        if (!parent) {
            // Closed the root container.
            this.rootEnded = true;
            return;
        }
        if (parent.kind === "object") {
            parent.state = "expect_comma_or_end";
            return;
        }
        if (parent.kind === "array") {
            parent.nextIndex += 1;
            parent.state = "expect_comma_or_end";
        }
    }

    private tryEmitEventPreview(frame: ObjectFrame): void {
        if (frame.eventIndex === undefined || frame.sourceStartIndex === undefined) return;
        const slice = this.buffer.slice(frame.sourceStartIndex, this.pos + 1);
        try {
            const parsed = JSON.parse(slice);
            const schemaResult = TurnEventSchema.safeParse(parsed);
            if (!schemaResult.success) return;
            this.pendingPreviewEmits.push({
                type: "turnEventPreview",
                eventIndex: frame.eventIndex,
                event: schemaResult.data,
            });
        } catch (_err) {
            // Ignore: bad event object means we just skip the preview.
        }
    }

    // Buffer event-object previews emitted from closeContainer (which is called
    // from inside step()), and drain them on each push iteration.
    private pendingPreviewEmits: SubmitTurnEventsPreviewEvent[] = [];

    private drainPendingPreviewEmits(out: SubmitTurnEventsPreviewEvent[]): void {
        if (this.pendingPreviewEmits.length === 0) return;
        for (const event of this.pendingPreviewEmits) out.push(event);
        this.pendingPreviewEmits.length = 0;
    }
}

function decodeJsonEscape(ch: string): string | null {
    switch (ch) {
        case "\"": return "\"";
        case "\\": return "\\";
        case "/": return "/";
        case "b": return "\b";
        case "f": return "\f";
        case "n": return "\n";
        case "r": return "\r";
        case "t": return "\t";
        default: return null;
    }
}
