export const AUTH_ERROR_CODES = [
    "auth.authentication_required",
    "auth.registration_not_available",
    "auth.registration_disabled",
    "auth.username_invalid",
    "auth.username_taken",
    "auth.login_not_available",
    "auth.invalid_credentials",
    "auth.display_name_too_long",
    "auth.password_too_short",
] as const;

export type AuthErrorCode = (typeof AUTH_ERROR_CODES)[number];

export const CHARACTER_ERROR_CODES = [
    "character.name_required",
    "character.not_found",
    "character.interaction_mode_immutable",
] as const;

export type CharacterErrorCode = (typeof CHARACTER_ERROR_CODES)[number];

export const CONVERSATION_ERROR_CODES = [
    "conversation.not_found",
] as const;

export type ConversationErrorCode = (typeof CONVERSATION_ERROR_CODES)[number];

export const CONVERSATION_ACTOR_ERROR_CODES = [
    "conversation_actor.display_name_required",
    "conversation_actor.not_found",
    "conversation_actor.not_editable",
    "conversation_actor.not_deletable",
    "conversation_actor.profile_snapshot_invalid",
] as const;

export type ConversationActorErrorCode = (typeof CONVERSATION_ACTOR_ERROR_CODES)[number];

export const USER_PREFERENCE_ERROR_CODES = [
    "user_preference.provider_required",
    "user_preference.provider_unsupported",
    "user_preference.api_key_required",
    "user_preference.model_call_purpose_invalid",
    "user_preference.model_required",
] as const;

export type UserPreferenceErrorCode = (typeof USER_PREFERENCE_ERROR_CODES)[number];

export const MEMORY_DEBUG_ERROR_CODES = [
    "memory.debug.characterId_required",
    "memory.debug.invalid_enum_value",
] as const;

export type MemoryDebugErrorCode = (typeof MEMORY_DEBUG_ERROR_CODES)[number];

export type AppErrorCode =
    | AuthErrorCode
    | CharacterErrorCode
    | ConversationErrorCode
    | ConversationActorErrorCode
    | UserPreferenceErrorCode
    | MemoryDebugErrorCode;

export type ErrorParams = Record<string, string | number>;
