import { z } from "zod";
import {
    ATMOSPHERE_VALUES,
    EXPRESSION_VALUES,
    STATE_UPDATE_TYPES,
    TURN_EVENT_TYPES,
} from "./turnEvents.js";
export type {
    AtmosphereValue,
    ExpressionEvent,
    ExpressionValue,
    FlagSetUpdate,
    ItemGrantedUpdate,
    MessageKind,
    RelationshipDeltaUpdate,
    ReplyTextEvent,
    SceneAtmosphereEvent,
    StateUpdateEvent,
    StateUpdateType,
    StateUpdateValue,
    SubmitTurnEventsArgs,
    TurnEvent,
    TurnEventType,
} from "./turnEvents.js";

export const ReplyTextEventSchema = z.object({
    type: z.literal(TURN_EVENT_TYPES.replyText),
    characterId: z.string().min(1),
    // replyText represents what the character actually says out loud. Empty or
    // whitespace-only text is rejected on purpose: a turn without spoken lines
    // must be expressed by omitting the replyText event entirely (the model can
    // still emit expression / sceneAtmosphere / stateUpdate events).
    text: z.string().refine((v) => v.trim().length > 0, {
        message: "replyText.text must be non-empty after trim",
    }),
}).strict();

export const ExpressionEventSchema = z.object({
    type: z.literal(TURN_EVENT_TYPES.expression),
    characterId: z.string().min(1),
    expression: z.enum(EXPRESSION_VALUES),
    intensity: z.number().min(0).max(1).optional(),
}).strict();

export const SceneAtmosphereEventSchema = z.object({
    type: z.literal(TURN_EVENT_TYPES.sceneAtmosphere),
    atmosphere: z.enum(ATMOSPHERE_VALUES),
    note: z.string().optional(),
}).strict();

export const ItemGrantedUpdateSchema = z.object({
    type: z.literal(STATE_UPDATE_TYPES.itemGranted),
    targetId: z.string().min(1),
    itemId: z.string().min(1),
    count: z.number().int().min(1),
    reason: z.string(),
}).strict();

export const FlagSetUpdateSchema = z.object({
    type: z.literal(STATE_UPDATE_TYPES.flagSet),
    key: z.string().min(1),
    value: z.union([z.string(), z.number(), z.boolean()]),
    reason: z.string(),
}).strict();

export const RelationshipDeltaUpdateSchema = z.object({
    type: z.literal(STATE_UPDATE_TYPES.relationshipDelta),
    characterId: z.string().min(1),
    targetId: z.string().min(1),
    value: z.number(),
    reason: z.string(),
}).strict();

export const StateUpdateValueSchema = z.discriminatedUnion("type", [
    ItemGrantedUpdateSchema,
    FlagSetUpdateSchema,
    RelationshipDeltaUpdateSchema,
]);

export const StateUpdateEventSchema = z.object({
    type: z.literal(TURN_EVENT_TYPES.stateUpdate),
    update: StateUpdateValueSchema,
}).strict();

export const TurnEventSchema = z.discriminatedUnion("type", [
    ReplyTextEventSchema,
    ExpressionEventSchema,
    SceneAtmosphereEventSchema,
    StateUpdateEventSchema,
]);

export const SubmitTurnEventsArgsSchema = z.object({
    events: z.array(TurnEventSchema).min(1),
}).strict();