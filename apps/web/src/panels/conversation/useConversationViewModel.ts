import { ref } from 'vue'
import type { ConversationInfo } from './conversationApi'
import {
    apiListConversations, apiCreateConversation,
    apiSelectConversation, apiDeleteConversation,
    apiUpdateConversationTitle,
} from './conversationApi'
import { activeCharacterId } from '../character/useCharacterViewModel'
import { useToast } from '../../shared/ui/useToast'
import { bumpContextVersion } from '../../shared/state/appState'

// ── Module-level singleton state ──────────────────────────────────────────────

export const conversations = ref<ConversationInfo[]>([])
export const activeConversationId = ref<string | null>(null)
export const isLoadingConversations = ref(false)

// ── Composable ────────────────────────────────────────────────────────────────

export function useConversationViewModel() {
    const toast = useToast()

    async function load(): Promise<void> {
        const charId = activeCharacterId.value
        if (!charId) return
        isLoadingConversations.value = true
        try {
            const res = await apiListConversations(charId)
            conversations.value = res.conversations
            activeConversationId.value = res.activeConversationId
            bumpContextVersion()
        } catch (e) {
            toast.error(e instanceof Error ? e.message : String(e))
        } finally {
            isLoadingConversations.value = false
        }
    }

    async function createConversation(): Promise<void> {
        const charId = activeCharacterId.value
        if (!charId) return
        isLoadingConversations.value = true
        try {
            const res = await apiCreateConversation(charId)
            conversations.value = res.conversations
            activeConversationId.value = res.activeConversationId
            bumpContextVersion()
        } catch (e) {
            toast.error(e instanceof Error ? e.message : String(e))
        } finally {
            isLoadingConversations.value = false
        }
    }

    async function selectConversation(conversationId: string): Promise<void> {
        const charId = activeCharacterId.value
        if (!charId || conversationId === activeConversationId.value) return
        try {
            const res = await apiSelectConversation(charId, conversationId)
            conversations.value = res.conversations
            activeConversationId.value = res.conversationId
            bumpContextVersion()
        } catch (e) {
            toast.error(e instanceof Error ? e.message : String(e))
        }
    }

    async function deleteConversation(conversationId: string): Promise<void> {
        const charId = activeCharacterId.value
        if (!charId) return
        try {
            const res = await apiDeleteConversation(charId, conversationId)
            conversations.value = res.conversations
            activeConversationId.value = res.activeConversationId
            bumpContextVersion()
        } catch (e) {
            toast.error(e instanceof Error ? e.message : String(e))
        }
    }

    async function updateTitle(conversationId: string, title: string | null): Promise<void> {
        const charId = activeCharacterId.value
        if (!charId) return
        try {
            await apiUpdateConversationTitle(charId, conversationId, title)
            const conv = conversations.value.find(c => c.id === conversationId)
            if (conv) conv.title = title
        } catch (e) {
            toast.error(e instanceof Error ? e.message : String(e))
        }
    }

    return {
        conversations, activeConversationId, isLoadingConversations,
        load, createConversation, selectConversation, deleteConversation, updateTitle,
    }
}
