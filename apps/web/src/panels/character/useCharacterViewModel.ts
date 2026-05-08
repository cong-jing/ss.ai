import { ref, computed } from 'vue'
import type { Character } from '@ss-ai/contracts'
import {
    apiListCharacters, apiCreateCharacter, apiUpdateCharacter,
    apiDeleteCharacter, apiSetActiveCharacter,
} from '../scenario/scenarioApi'
import { useToast } from '../../shared/ui/useToast'
import { bumpContextVersion } from '../../shared/state/appState'

// ── Module-level singleton state ──────────────────────────────────────────────

export const characters = ref<Character[]>([])
export const activeCharacterId = ref<string | null>(null)
export const isLoadingCharacters = ref(false)
export const isSavingCharacter = ref(false)

export const activeCharacter = computed<Character | null>(
    () => characters.value.find(c => c.id === activeCharacterId.value) ?? null,
)

export const editDraft = ref<{
    name: string; description: string; personaPrompt: string; greetingMessage: string
}>({ name: '', description: '', personaPrompt: '', greetingMessage: '' })

function syncDraft(): void {
    const c = activeCharacter.value
    editDraft.value = {
        name: c?.name ?? '',
        description: c?.description ?? '',
        personaPrompt: c?.personaPrompt ?? '',
        greetingMessage: c?.greetingMessage ?? '',
    }
}

// ── Composable ────────────────────────────────────────────────────────────────

export function useCharacterViewModel() {
    const toast = useToast()

    async function load(): Promise<void> {
        isLoadingCharacters.value = true
        try {
            const { characters: list, activeCharacterId: currentId } = await apiListCharacters()
            characters.value = list
            activeCharacterId.value = currentId
            syncDraft()
        } catch (e) {
            toast.error(e instanceof Error ? e.message : String(e))
        } finally {
            isLoadingCharacters.value = false
        }
    }

    async function select(id: string): Promise<void> {
        if (id === activeCharacterId.value) return
        try {
            await apiSetActiveCharacter(id)
            activeCharacterId.value = id
            syncDraft()
            bumpContextVersion()
        } catch (e) {
            toast.error(e instanceof Error ? e.message : String(e))
        }
    }

    async function create(
        name: string, description: string, personaPrompt: string, greetingMessage: string,
    ): Promise<Character | null> {
        if (!name.trim()) return null
        isSavingCharacter.value = true
        try {
            const created = await apiCreateCharacter(
                name.trim(), description.trim(), personaPrompt.trim(),
                greetingMessage.trim() || undefined,
            )
            characters.value.push(created)
            await apiSetActiveCharacter(created.id)
            activeCharacterId.value = created.id
            syncDraft()
            bumpContextVersion()
            return created
        } catch (e) {
            toast.error(e instanceof Error ? e.message : String(e))
            return null
        } finally {
            isSavingCharacter.value = false
        }
    }

    async function save(): Promise<void> {
        if (!activeCharacterId.value) return
        isSavingCharacter.value = true
        try {
            const updated = await apiUpdateCharacter(activeCharacterId.value, {
                name: editDraft.value.name,
                description: editDraft.value.description,
                personaPrompt: editDraft.value.personaPrompt,
                greetingMessage: editDraft.value.greetingMessage,
            })
            const idx = characters.value.findIndex(c => c.id === updated.id)
            if (idx !== -1) characters.value[idx] = updated
        } catch (e) {
            toast.error(e instanceof Error ? e.message : String(e))
        } finally {
            isSavingCharacter.value = false
        }
    }

    async function remove(): Promise<void> {
        if (!activeCharacterId.value) return
        const confirmDelete = window.confirm(
            `Delete character "${activeCharacter.value?.name ?? ''}"? This cannot be undone.`,
        )
        if (!confirmDelete) return
        isSavingCharacter.value = true
        try {
            const deletedId = activeCharacterId.value
            await apiDeleteCharacter(deletedId)
            characters.value = characters.value.filter(c => c.id !== deletedId)
            const next = characters.value[0] ?? null
            if (next) {
                await apiSetActiveCharacter(next.id)
                activeCharacterId.value = next.id
            } else {
                activeCharacterId.value = null
            }
            syncDraft()
            bumpContextVersion()
        } catch (e) {
            toast.error(e instanceof Error ? e.message : String(e))
        } finally {
            isSavingCharacter.value = false
        }
    }

    return {
        characters, activeCharacterId, activeCharacter, isLoadingCharacters, isSavingCharacter,
        editDraft, load, select, create, save, remove, syncDraft,
    }
}
