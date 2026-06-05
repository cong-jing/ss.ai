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

export const TURN_EVENT_TYPES = {
    replyText: "replyText",
    expression: "expression",
    sceneAtmosphere: "sceneAtmosphere",
    stateUpdate: "stateUpdate",
} as const;

export const STATE_UPDATE_TYPES = {
    itemGranted: "itemGranted",
    flagSet: "flagSet",
    relationshipDelta: "relationshipDelta",
} as const;

export type ExpressionValue = typeof EXPRESSION_VALUES[number];
export type AtmosphereValue = typeof ATMOSPHERE_VALUES[number];
export type TurnEventType = typeof TURN_EVENT_TYPES[keyof typeof TURN_EVENT_TYPES];
export type StateUpdateType = typeof STATE_UPDATE_TYPES[keyof typeof STATE_UPDATE_TYPES];

export type ReplyTextEvent = {
    type: typeof TURN_EVENT_TYPES.replyText;
    characterId: string;
    text: string;
};

export type ExpressionEvent = {
    type: typeof TURN_EVENT_TYPES.expression;
    characterId: string;
    expression: ExpressionValue;
    intensity?: number;
};

export type SceneAtmosphereEvent = {
    type: typeof TURN_EVENT_TYPES.sceneAtmosphere;
    atmosphere: AtmosphereValue;
    note?: string;
};

export type ItemGrantedUpdate = {
    type: typeof STATE_UPDATE_TYPES.itemGranted;
    targetId: string;
    itemId: string;
    count: number;
    reason: string;
};

export type FlagSetUpdate = {
    type: typeof STATE_UPDATE_TYPES.flagSet;
    key: string;
    value: string | number | boolean;
    reason: string;
};

export type RelationshipDeltaUpdate = {
    type: typeof STATE_UPDATE_TYPES.relationshipDelta;
    characterId: string;
    targetId: string;
    value: number;
    reason: string;
};

export type StateUpdateValue = ItemGrantedUpdate | FlagSetUpdate | RelationshipDeltaUpdate;

export type StateUpdateEvent = {
    type: typeof TURN_EVENT_TYPES.stateUpdate;
    update: StateUpdateValue;
};

export type TurnEvent = ReplyTextEvent | ExpressionEvent | SceneAtmosphereEvent | StateUpdateEvent;

export type SubmitTurnEventsArgs = {
    events: TurnEvent[];
};

export type MessageKind =
    | "user_text"
    | "assistant_turn_events"
    | "system_text";
