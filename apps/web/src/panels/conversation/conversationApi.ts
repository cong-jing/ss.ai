import type { ConversationInfo } from '@ss-ai/contracts'
import {
    apiListConversations, apiCreateConversation,
    apiSelectConversation, apiDeleteConversation,
} from '../scenario/scenarioApi'

export type { ConversationInfo }
export { apiListConversations, apiCreateConversation, apiSelectConversation, apiDeleteConversation }

/** Stub – PATCH endpoint not yet implemented on the server. */
export async function apiUpdateConversationTitle(
    _characterId: string,
    _conversationId: string,
    _title: string | null,
): Promise<void> {
    throw new Error('Update conversation title: not implemented yet')
}
