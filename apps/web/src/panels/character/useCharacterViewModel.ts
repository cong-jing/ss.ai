import { ref, computed } from 'vue'
import type { Character, CharacterModelConfig, InteractionMode } from '@ss-ai/contracts'
import { MODEL_CALL_PURPOSES, DEFAULT_INTERACTION_MODE, type ModelCallPurpose } from '@ss-ai/contracts'
import {
    apiListCharacters, apiListCharacterInteractionModes, apiCreateCharacter, apiUpdateCharacter,
    apiDeleteCharacter, apiSetActiveCharacter,
} from '../userProfile/userProfileApi'
import { useToast } from '../../shared/ui/useToast'
import { bumpContextVersion } from '../../shared/state/appState'
import { t } from "../../shared/i18n/i18n";

// ── Module-level singleton state ──────────────────────────────────────────────

export const characters = ref<Character[]>([])
export const interactionModes = ref<InteractionMode[]>([])
export const activeCharacterId = ref<string | null>(null)
export const isLoadingCharacters = ref(false)
export const isSavingCharacter = ref(false)

export const activeCharacter = computed<Character | null>(
    () => characters.value.find(c => c.id === activeCharacterId.value) ?? null,
)

export type FnOverride = { enabled: boolean; provider: string; model: string }

function emptyOverrides(): Record<ModelCallPurpose, FnOverride> {
    return Object.fromEntries(
        MODEL_CALL_PURPOSES.map(fn => [fn, { enabled: false, provider: '', model: '' }])
    ) as Record<ModelCallPurpose, FnOverride>
}

export const editDraft = ref<{
    name: string; displayName: string; description: string; personaPrompt: string; greetingMessage: string; interactionMode: InteractionMode
    modelOverrides: Record<ModelCallPurpose, FnOverride>
}>({ name: '', displayName: '', description: '', personaPrompt: '', greetingMessage: '', interactionMode: DEFAULT_INTERACTION_MODE, modelOverrides: emptyOverrides() })

const savedDraftJson = ref('')
export const isDirty = computed(() => JSON.stringify(editDraft.value) !== savedDraftJson.value)

function syncDraft(): void {
    const c = activeCharacter.value
    const defaultInteractionMode = interactionModes.value.includes(DEFAULT_INTERACTION_MODE)
        ? DEFAULT_INTERACTION_MODE
        : (interactionModes.value[0] ?? DEFAULT_INTERACTION_MODE)
    const overrides = emptyOverrides()
    if (c?.modelConfig) {
        for (const fn of MODEL_CALL_PURPOSES) {
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
        interactionMode: c?.interactionMode ?? defaultInteractionMode,
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
            const [{ characters: list, activeCharacterId: currentId }, interactionModeRes] = await Promise.all([
                apiListCharacters(),
                apiListCharacterInteractionModes(),
            ])
            characters.value = list
            interactionModes.value = interactionModeRes.interactionModes
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
                editDraft.value.interactionMode,
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
            for (const purpose of MODEL_CALL_PURPOSES) {
                const ov = editDraft.value.modelOverrides[purpose]
                if (ov.enabled && ov.provider && ov.model) {
                    modelConfig[purpose] = { provider: ov.provider, model: ov.model }
                }
            }
            const updated = await apiUpdateCharacter(activeCharacterId.value, {
                name: editDraft.value.name,
                displayName: editDraft.value.displayName,
                description: editDraft.value.description,
                personaPrompt: editDraft.value.personaPrompt,
                greetingMessage: editDraft.value.greetingMessage,
                interactionMode: editDraft.value.interactionMode,
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
            t("sidebar.confirmDeleteCharacter", { name: activeCharacter.value?.name ?? "" }),
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
        interactionModes,
        editDraft, isDirty, load, select, create, save, remove, syncDraft,
    }
}
