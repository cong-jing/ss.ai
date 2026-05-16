import { ref, computed } from 'vue'
import type { Character, CharacterModelConfig, PromptMode } from '@ss-ai/contracts'
import { AI_FUNCTIONS, DEFAULT_PROMPT_MODE, type AiFunction } from '@ss-ai/contracts'
import {
    apiListCharacters, apiListCharacterPromptModes, apiCreateCharacter, apiUpdateCharacter,
    apiDeleteCharacter, apiSetActiveCharacter,
} from '../userProfile/userProfileApi'
import { useToast } from '../../shared/ui/useToast'
import { bumpContextVersion } from '../../shared/state/appState'

// ── Module-level singleton state ──────────────────────────────────────────────

export const characters = ref<Character[]>([])
export const promptModes = ref<PromptMode[]>([])
export const activeCharacterId = ref<string | null>(null)
export const isLoadingCharacters = ref(false)
export const isSavingCharacter = ref(false)

export const activeCharacter = computed<Character | null>(
    () => characters.value.find(c => c.id === activeCharacterId.value) ?? null,
)

export type FnOverride = { enabled: boolean; provider: string; model: string }

function emptyOverrides(): Record<AiFunction, FnOverride> {
    return Object.fromEntries(
        AI_FUNCTIONS.map(fn => [fn, { enabled: false, provider: '', model: '' }])
    ) as Record<AiFunction, FnOverride>
}

export const editDraft = ref<{
    name: string; displayName: string; description: string; personaPrompt: string; greetingMessage: string; promptMode: PromptMode
    modelOverrides: Record<AiFunction, FnOverride>
}>({ name: '', displayName: '', description: '', personaPrompt: '', greetingMessage: '', promptMode: DEFAULT_PROMPT_MODE, modelOverrides: emptyOverrides() })

const savedDraftJson = ref('')
export const isDirty = computed(() => JSON.stringify(editDraft.value) !== savedDraftJson.value)

function syncDraft(): void {
    const c = activeCharacter.value
    const defaultPromptMode = promptModes.value.includes(DEFAULT_PROMPT_MODE)
        ? DEFAULT_PROMPT_MODE
        : (promptModes.value[0] ?? DEFAULT_PROMPT_MODE)
    const overrides = emptyOverrides()
    if (c?.modelConfig) {
        for (const fn of AI_FUNCTIONS) {
            const cfg = c.modelConfig[fn]
            if (cfg) {
                overrides[fn] = { enabled: true, provider: cfg.provider, model: cfg.model }
            }
        }
    }
    editDraft.value = {
        name: c?.name ?? '',
        displayName: c?.displayName ?? '',
        description: c?.description ?? '',
        personaPrompt: c?.personaPrompt ?? '',
        greetingMessage: c?.greetingMessage ?? '',
        promptMode: c?.promptMode ?? defaultPromptMode,
        modelOverrides: overrides,
    }
    savedDraftJson.value = JSON.stringify(editDraft.value)
}

// ── Composable ────────────────────────────────────────────────────────────────

export function useCharacterViewModel() {
    const toast = useToast()

    async function load(): Promise<void> {
        isLoadingCharacters.value = true
        try {
            const [{ characters: list, activeCharacterId: currentId }, promptModeRes] = await Promise.all([
                apiListCharacters(),
                apiListCharacterPromptModes(),
            ])
            characters.value = list
            promptModes.value = promptModeRes.promptModes
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
        name: string, displayName: string, description: string, personaPrompt: string, greetingMessage: string,
    ): Promise<Character | null> {
        if (!name.trim()) return null
        isSavingCharacter.value = true
        try {
            const created = await apiCreateCharacter(
                name.trim(), displayName.trim(), description.trim(), personaPrompt.trim(),
                greetingMessage.trim() || undefined,
                editDraft.value.promptMode,
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
            const modelConfig: CharacterModelConfig = {}
            for (const fn of AI_FUNCTIONS) {
                const ov = editDraft.value.modelOverrides[fn]
                if (ov.enabled && ov.provider && ov.model) {
                    modelConfig[fn] = { provider: ov.provider, model: ov.model }
                }
            }
            const updated = await apiUpdateCharacter(activeCharacterId.value, {
                name: editDraft.value.name,
                displayName: editDraft.value.displayName,
                description: editDraft.value.description,
                personaPrompt: editDraft.value.personaPrompt,
                greetingMessage: editDraft.value.greetingMessage,
                promptMode: editDraft.value.promptMode,
                modelConfig,
            })
            const idx = characters.value.findIndex(c => c.id === updated.id)
            if (idx !== -1) characters.value[idx] = updated
            syncDraft()
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
        promptModes,
        editDraft, isDirty, load, select, create, save, remove, syncDraft,
    }
}
