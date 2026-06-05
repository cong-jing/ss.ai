import { z } from "zod";

export const EXPRESSION_VALUES = [
    "neutral",
    "happy",
    "sad",
    "angry",
    "shy",
    "surprised",
] as const;

export const ATMOSPHERE_VALUES = [
    "neutral",
    "calm",
    "tense",
    "romantic",
    "sad",
    "mysterious",
    "comical",
] as const;

export const ReplyTextEventSchema = z.object({
    type: z.literal("replyText"),
    characterId: z.string().min(1),
    text: z.string(),
}).strict();

export const ExpressionEventSchema = z.object({
    type: z.literal("expression"),
    characterId: z.string().min(1),
    expression: z.enum(EXPRESSION_VALUES),
    intensity: z.number().min(0).max(1).optional(),
}).strict();

export const SceneAtmosphereEventSchema = z.object({
    type: z.literal("sceneAtmosphere"),
    atmosphere: z.enum(ATMOSPHERE_VALUES),
    note: z.string().optional(),
}).strict();

export const ItemGrantedUpdateSchema = z.object({
    type: z.literal("itemGranted"),
    targetId: z.string().min(1),
    itemId: z.string().min(1),
    count: z.number().int().min(1),
    reason: z.string(),
}).strict();

export const FlagSetUpdateSchema = z.object({
    type: z.literal("flagSet"),
    key: z.string().min(1),
    value: z.union([z.string(), z.number(), z.boolean()]),
    reason: z.string(),
}).strict();

export const RelationshipDeltaUpdateSchema = z.object({
    type: z.literal("relationshipDelta"),
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
    type: z.literal("stateUpdate"),
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

export type ReplyTextEvent = z.infer<typeof ReplyTextEventSchema>;
export type ExpressionEvent = z.infer<typeof ExpressionEventSchema>;
export type SceneAtmosphereEvent = z.infer<typeof SceneAtmosphereEventSchema>;
export type ItemGrantedUpdate = z.infer<typeof ItemGrantedUpdateSchema>;
export type FlagSetUpdate = z.infer<typeof FlagSetUpdateSchema>;
export type RelationshipDeltaUpdate = z.infer<typeof RelationshipDeltaUpdateSchema>;
export type StateUpdateValue = z.infer<typeof StateUpdateValueSchema>;
export type StateUpdateEvent = z.infer<typeof StateUpdateEventSchema>;
export type TurnEvent = z.infer<typeof TurnEventSchema>;
export type SubmitTurnEventsArgs = z.infer<typeof SubmitTurnEventsArgsSchema>;

export type MessageKind =
    | "user_text"
    | "assistant_turn_events"
    | "system_text";
