import { ref } from 'vue'
import type { ConversationActor } from './conversationApi'
import {
    apiListConversationActors,
    apiCreateConversationActor,
    apiUpdateConversationActor,
    apiDeleteConversationActor,
} from './conversationApi'
import { activeConversationId } from './useConversationViewModel'
import { useToast } from '../../shared/ui/useToast'

export const actors = ref<ConversationActor[]>([])
export const selectedActorId = ref<string | null>(null)
export const expandedActorIds = ref<string[]>([])
export const isLoadingActors = ref(false)
export const isSavingActor = ref(false)

export function isDefaultLoggedUserActor(actor: ConversationActor): boolean {
    return actor.sourceType === 'logged_user' && actor.userProfileId === 'default'
}

function ensureSelectedActor(): void {
    if (actors.value.length === 0) {
        selectedActorId.value = null
        return
    }
    if (selectedActorId.value && actors.value.some(a => a.id === selectedActorId.value)) {
        return
    }
    const defaultActor = actors.value.find(isDefaultLoggedUserActor)
    selectedActorId.value = defaultActor?.id ?? actors.value[0].id
}

export function useActorViewModel() {
    const toast = useToast()

    async function load(): Promise<void> {
        const convId = activeConversationId.value
        if (!convId) {
            actors.value = []
            selectedActorId.value = null
            expandedActorIds.value = []
            return
        }

        isLoadingActors.value = true
        try {
            const res = await apiListConversationActors(convId)
            actors.value = res.actors
            ensureSelectedActor()
            expandedActorIds.value = expandedActorIds.value.filter(id => actors.value.some(a => a.id === id))
        } catch (e) {
            actors.value = []
            selectedActorId.value = null
            toast.error(e instanceof Error ? e.message : String(e))
        } finally {
            isLoadingActors.value = false
        }
    }

    function select(id: string): void {
        selectedActorId.value = id
    }

    function toggleExpand(id: string): void {
        if (expandedActorIds.value.includes(id)) {
            expandedActorIds.value = expandedActorIds.value.filter(item => item !== id)
        } else {
            expandedActorIds.value = [...expandedActorIds.value, id]
        }
    }

    async function createActor(displayName: string): Promise<void> {
        const convId = activeConversationId.value
        const name = displayName.trim()
        if (!convId || !name) return

        isSavingActor.value = true
        try {
            const { actor } = await apiCreateConversationActor(convId, { displayName: name })
            actors.value = [...actors.value, actor]
            selectedActorId.value = actor.id
            expandedActorIds.value = [...expandedActorIds.value, actor.id]
        } catch (e) {
            toast.error(e instanceof Error ? e.message : String(e))
        } finally {
            isSavingActor.value = false
        }
    }

    async function updateActor(input: {
        actorId: string
        displayName?: string
        profileSnapshotJson?: string | null
    }): Promise<void> {
        const convId = activeConversationId.value
        if (!convId) return

        isSavingActor.value = true
        try {
            const { actor } = await apiUpdateConversationActor(convId, input.actorId, {
                displayName: input.displayName,
                profileSnapshotJson: input.profileSnapshotJson,
            })
            actors.value = actors.value.map(item => (item.id === actor.id ? actor : item))
        } catch (e) {
            toast.error(e instanceof Error ? e.message : String(e))
        } finally {
            isSavingActor.value = false
        }
    }

    async function deleteActor(actorId: string): Promise<void> {
        const convId = activeConversationId.value
        if (!convId) return
        const actor = actors.value.find(item => item.id === actorId)
        if (!actor || actor.sourceType !== 'local_actor') return

        isSavingActor.value = true
        try {
            await apiDeleteConversationActor(convId, actorId)
            actors.value = actors.value.filter(item => item.id !== actorId)
            expandedActorIds.value = expandedActorIds.value.filter(id => id !== actorId)
            if (selectedActorId.value === actorId) {
                ensureSelectedActor()
            }
        } catch (e) {
            toast.error(e instanceof Error ? e.message : String(e))
        } finally {
            isSavingActor.value = false
        }
    }

    return {
        actors,
        selectedActorId,
        expandedActorIds,
        isLoadingActors,
        isSavingActor,
        load,
        select,
        toggleExpand,
        createActor,
        updateActor,
        deleteActor,
    }
}
