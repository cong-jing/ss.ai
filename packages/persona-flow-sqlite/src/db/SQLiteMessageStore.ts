import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { TurnEventSchema } from "@ss-ai/contracts/turnEvents.schema";
import { messages, turnEvents, type MessageRow, type TurnEventRow } from "./schema.js";
import type { DrizzleDb } from "./openDatabase.js";
import type { Message } from "@ss-ai/persona-flow";
import type { CharacterDbRouter } from "./CharacterDbRouter.js";

function rowToMessage(row: MessageRow, events: NonNullable<Message["turnEvents"]> = []): Message {
    return {
        id: row.id,
        conversationId: row.conversationId,
        senderActorId: row.senderActorId,
        kind: row.kind as Message["kind"],
        displayText: row.displayText,
        ...(events.length > 0 ? { turnEvents: events } : {}),
        createdAt: row.createdAt,
    };
}

function rowToTurnEvent(row: TurnEventRow): NonNullable<Message["turnEvents"]>[number] | null {
    if (row.schemaVersion !== 1) {
        return null;
    }

    try {
        const parsed = TurnEventSchema.safeParse(JSON.parse(row.payloadJson));
        return parsed.success ? parsed.data : null;
    } catch {
        return null;
    }
}

export class SQLiteMessageStore {
    constructor(
        private readonly db: DrizzleDb,
        private readonly characterDbRouter?: CharacterDbRouter,
    ) { }

    async appendMessage(message: Message): Promise<void> {
        const db = await this.getDbForConversation(message.conversationId);
        await db.insert(messages).values({
            id: message.id,
            conversationId: message.conversationId,
            senderActorId: message.senderActorId,
            kind: message.kind,
            displayText: message.displayText,
            createdAt: message.createdAt,
        });
    }

    async appendAssistantTurn(input: { message: Message; events: NonNullable<Message["turnEvents"]> }): Promise<void> {
        const db = await this.getDbForConversation(input.message.conversationId);
        await db.transaction(async (tx) => {
            await tx.insert(messages).values({
                id: input.message.id,
                conversationId: input.message.conversationId,
                senderActorId: input.message.senderActorId,
                kind: "assistant_turn_events",
                displayText: input.message.displayText,
                createdAt: input.message.createdAt,
            });
            if (input.events.length > 0) {
                await tx.insert(turnEvents).values(input.events.map((event, index) => ({
                    id: crypto.randomUUID(),
                    messageId: input.message.id,
                    conversationId: input.message.conversationId,
                    seq: index,
                    type: event.type,
                    payloadJson: JSON.stringify(event),
                    schemaVersion: 1,
                    createdAt: input.message.createdAt,
                })));
            }
        });
    }

    async getRecentMessages(input: {
        userId?: string;
        conversationId: string;
        limit: number;
    }): Promise<Message[]> {
        const db = await this.getDbForConversation(input.conversationId);
        const rows = await db
            .select()
            .from(messages)
            .where(eq(messages.conversationId, input.conversationId))
            .orderBy(desc(messages.createdAt))
            .limit(input.limit);

        const orderedRows = rows.reverse();
        const messageIds = orderedRows.map(row => row.id);
        const eventRows = messageIds.length > 0
            ? await db
                .select()
                .from(turnEvents)
                .where(inArray(turnEvents.messageId, messageIds))
                .orderBy(asc(turnEvents.messageId), asc(turnEvents.seq))
            : [];
        const eventsByMessageId = new Map<string, NonNullable<Message["turnEvents"]>>();
        for (const row of eventRows) {
            const event = rowToTurnEvent(row);
            if (!event) {
                continue;
            }
            const list = eventsByMessageId.get(row.messageId) ?? [];
            list.push(event);
            eventsByMessageId.set(row.messageId, list);
        }

        return orderedRows.map(row => rowToMessage(row, eventsByMessageId.get(row.id) ?? []));
    }

    async deleteMessage(input: { conversationId: string; messageId: string }): Promise<void> {
        const db = await this.getDbForConversation(input.conversationId);
        await db.transaction(async (tx) => {
            await tx
                .delete(turnEvents)
                .where(and(
                    eq(turnEvents.conversationId, input.conversationId),
                    eq(turnEvents.messageId, input.messageId),
                ));
            await tx
                .delete(messages)
                .where(and(
                    eq(messages.conversationId, input.conversationId),
                    eq(messages.id, input.messageId),
                ));
        });
    }

    private async getDbForConversation(conversationId: string): Promise<DrizzleDb> {
        if (!this.characterDbRouter) {
            return this.db;
        }
        return await this.characterDbRouter.getDbForConversation({ conversationId });
    }
}
