
export const INTERACTION_MODES = [
    /**
     * 单角色连续对话模式。
     *
     * 模型始终扮演同一个角色，适合角色陪聊、单人 RP、恋爱模拟等。
     * history 可以使用 user / assistant 交替消息。
     * assistant 历史表示该角色过去的真实回复，通常不带角色名前缀。
     */
    "single_character_chat",
    /**
     * 多角色事件日志模式。
     *
     * 适合多角色、多动作、多场景变化的复杂 RP。
     * 历史作为事件日志渲染，而不是强行映射为 user / assistant 对话。
     * 常见事件包括 dialogue、action、scene、state 等。
     */
    "multi_character_event_log",
    /**
     * 地下城主 / 叙事者模式。
     *
     * 模型扮演 GM / DM / Narrator，负责描述世界、扮演 NPC、裁定玩家行动并推进故事。
     * assistant 历史可以表示 GM 过去的叙事和裁定。
     * 程序应额外维护正式世界状态，避免只依赖自然语言历史。
     */
    "dm_narrator",
    /**
     * 直播间 / 群聊模式。
     *
     * 适合多个外部用户输入、单个角色输出的场景。
     * user message 可以合并多名观众 / 群成员的发言。
     * assistant 始终表示当前角色或主播的回复。
     */
    "live_chat",
] as const;

export type InteractionMode = typeof INTERACTION_MODES[number];

export const DEFAULT_INTERACTION_MODE: InteractionMode = "single_character_chat";

