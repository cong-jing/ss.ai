import type { AppErrorCode } from "@ss-ai/contracts";
import type { MessageKey } from "../i18n/messages";
import { t } from "../i18n/i18n";
import { ApiRequestError } from "./apiRequestError";

const ERROR_MESSAGE_KEYS: Record<AppErrorCode, MessageKey> = {
    "auth.authentication_required": "serverError.auth.authenticationRequired",
    "auth.registration_not_available": "serverError.auth.registrationNotAvailable",
    "auth.registration_disabled": "serverError.auth.registrationDisabled",
    "auth.username_invalid": "serverError.auth.usernameInvalid",
    "auth.username_taken": "serverError.auth.usernameTaken",
    "auth.login_not_available": "serverError.auth.loginNotAvailable",
    "auth.invalid_credentials": "serverError.auth.invalidCredentials",
    "auth.display_name_too_long": "serverError.auth.displayNameTooLong",
    "auth.password_too_short": "serverError.auth.passwordTooShort",
    "character.name_required": "serverError.character.nameRequired",
    "character.not_found": "serverError.character.notFound",
    "character.interaction_mode_immutable": "serverError.character.interactionModeImmutable",
    "conversation.not_found": "serverError.conversation.notFound",
    "conversation_actor.display_name_required": "serverError.conversationActor.displayNameRequired",
    "conversation_actor.not_found": "serverError.conversationActor.notFound",
    "conversation_actor.not_editable": "serverError.conversationActor.notEditable",
    "conversation_actor.not_deletable": "serverError.conversationActor.notDeletable",
    "conversation_actor.profile_snapshot_invalid": "serverError.conversationActor.profileSnapshotInvalid",
    "user_preference.provider_required": "serverError.userPreference.providerRequired",
    "user_preference.provider_unsupported": "serverError.userPreference.providerUnsupported",
    "user_preference.api_key_required": "serverError.userPreference.apiKeyRequired",
    "user_preference.model_call_purpose_invalid": "serverError.userPreference.modelCallPurposeInvalid",
    "user_preference.model_required": "serverError.userPreference.modelRequired",
    "memory.debug.characterId_required": "serverError.memoryDebug.characterIdRequired",
    "memory.debug.invalid_enum_value": "serverError.memoryDebug.invalidEnumValue",
};

export function localizeApiError(error: unknown): string {
    if (error instanceof ApiRequestError && error.code) {
        const key = ERROR_MESSAGE_KEYS[error.code as AppErrorCode];
        if (typeof key === "string") {
            return t(key, error.params);
        }
    }
    return error instanceof Error ? error.message : String(error);
}
