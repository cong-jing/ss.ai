/**
 * Interaction mode values with rename-friendly keys.
 *
 * Prefer referencing `InteractionModeValue.*` in code (instead of raw strings),
 * so IDE rename (F2) works across the codebase.
 */
export const InteractionModeValue = {
    /**
     * 单角色连续对话模式。
     *
     * 模型始终扮演同一个角色，适合角色陪聊、单人 RP、恋爱模拟等。
     * history 可以使用 user / assistant 交替消息。
     * assistant 历史表示该角色过去的真实回复，通常不带角色名前缀。
     */
    singleCharacterChat: "single_character_chat",
    /**
     * 群聊模式。
     *
     * 适合多个外部用户输入、单个角色输出的场景。
     * user message 可以合并多名观众 / 群成员的发言。
     * assistant 始终表示当前角色或主播的回复。
     */
    groupChat: "group_chat",
    /**
     * 地下城主 / 叙事者模式。
     *
     * 模型扮演 GM / DM / Narrator，负责描述世界、扮演 NPC、裁定玩家行动并推进故事。
     * assistant 历史可以表示 GM 过去的叙事和裁定。
     * 程序应额外维护正式世界状态，避免只依赖自然语言历史。
     */
    dmNarrator: "dm_narrator",
} as const;

export type InteractionMode = typeof InteractionModeValue[keyof typeof InteractionModeValue];

export const INTERACTION_MODES = [
    InteractionModeValue.singleCharacterChat,
    InteractionModeValue.groupChat,
    InteractionModeValue.dmNarrator,
] as const;

export const DEFAULT_INTERACTION_MODE: InteractionMode = InteractionModeValue.singleCharacterChat;

/**
 * UI-facing i18n keys for each interaction mode.
 * Keep this map aligned with INTERACTION_MODES so callers never need hard-coded mode strings.
 */
export const INTERACTION_MODE_I18N_KEYS: Record<InteractionMode, `interactionMode.${InteractionMode}`> = {
    [InteractionModeValue.singleCharacterChat]: "interactionMode.single_character_chat",
    [InteractionModeValue.groupChat]: "interactionMode.group_chat",
    [InteractionModeValue.dmNarrator]: "interactionMode.dm_narrator",
};

