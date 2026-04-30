import { ref, computed } from "vue";
import type { Character } from "@ss-ai/contracts";
import {
    apiGetUserInfo, apiSaveUserInfo,
    apiListCharacters, apiCreateCharacter, apiUpdateCharacter, apiDeleteCharacter,
    apiSetActiveCharacter,
} from "./scenarioApi";
import type { UserInfo } from "./scenarioTypes";

export function useScenarioViewModel() {
    // ── User ─────────────────────────────────────────────────────────────────

    const userInfo = ref<UserInfo>({ name: "", bio: "" });
    const isLoadingUser = ref(false);
    const isSavingUser = ref(false);
    const userError = ref<string | null>(null);

    async function loadUserInfo(): Promise<void> {
        isLoadingUser.value = true;
        userError.value = null;
        try {
            userInfo.value = await apiGetUserInfo();
        } catch (e) {
            userError.value = e instanceof Error ? e.message : String(e);
        } finally {
            isLoadingUser.value = false;
        }
    }

    async function saveUserInfo(): Promise<void> {
        isSavingUser.value = true;
        userError.value = null;
        try {
            userInfo.value = await apiSaveUserInfo(userInfo.value);
        } catch (e) {
            userError.value = e instanceof Error ? e.message : String(e);
        } finally {
            isSavingUser.value = false;
        }
    }

    // ── Character list ────────────────────────────────────────────────────────

    const characters = ref<Character[]>([]);
    const activeCharacterId = ref<string | null>(null);
    const isLoadingCharacters = ref(false);
    const characterError = ref<string | null>(null);
    const isSavingCharacter = ref(false);

    /** The currently selected Character object (derived from list + activeCharacterId). */
    const activeCharacter = computed<Character | null>(
        () => characters.value.find(c => c.id === activeCharacterId.value) ?? null
    );

    /** Editable draft for the active character's fields. */
    const editDraft = ref<{ name: string; description: string; personaPrompt: string; greetingMessage: string }>({
        name: "", description: "", personaPrompt: "", greetingMessage: "",
    });

    // ── Inline create form ────────────────────────────────────────────────────

    const isCreating = ref(false);
    const newName = ref("");
    const newDescription = ref("");
    const newPersonaPrompt = ref("");
    const newGreetingMessage = ref("");

    function openCreateForm(): void {
        newName.value = "";
        newDescription.value = "";
        newPersonaPrompt.value = "";
        newGreetingMessage.value = "";
        isCreating.value = true;
    }

    function cancelCreate(): void {
        isCreating.value = false;
    }

    // ── Load ──────────────────────────────────────────────────────────────────

    async function loadCharacters(): Promise<void> {
        isLoadingCharacters.value = true;
        characterError.value = null;
        try {
            const { characters: list, activeCharacterId: currentId } = await apiListCharacters();
            characters.value = list;
            activeCharacterId.value = currentId;
            syncDraft();
        } catch (e) {
            characterError.value = e instanceof Error ? e.message : String(e);
        } finally {
            isLoadingCharacters.value = false;
        }
    }

    /** Copy active character fields into editDraft. */
    function syncDraft(): void {
        const c = activeCharacter.value;
        editDraft.value = {
            name: c?.name ?? "",
            description: c?.description ?? "",
            personaPrompt: c?.personaPrompt ?? "",
            greetingMessage: c?.greetingMessage ?? "",
        };
    }

    // ── Select ────────────────────────────────────────────────────────────────

    async function selectCharacter(id: string): Promise<void> {
        if (id === activeCharacterId.value) return;
        characterError.value = null;
        try {
            await apiSetActiveCharacter(id);
            activeCharacterId.value = id;
            syncDraft();
        } catch (e) {
            characterError.value = e instanceof Error ? e.message : String(e);
        }
    }

    // ── Create ────────────────────────────────────────────────────────────────

    async function createCharacter(): Promise<void> {
        const name = newName.value.trim();
        if (!name) return;
        isSavingCharacter.value = true;
        characterError.value = null;
        try {
            const created = await apiCreateCharacter(
                name,
                newDescription.value.trim(),
                newPersonaPrompt.value.trim(),
                newGreetingMessage.value.trim() || undefined,
            );
            characters.value.push(created);
            await apiSetActiveCharacter(created.id);
            activeCharacterId.value = created.id;
            syncDraft();
            isCreating.value = false;
        } catch (e) {
            characterError.value = e instanceof Error ? e.message : String(e);
        } finally {
            isSavingCharacter.value = false;
        }
    }

    // ── Save (update) ─────────────────────────────────────────────────────────

    async function saveCharacter(): Promise<void> {
        if (!activeCharacterId.value) return;
        isSavingCharacter.value = true;
        characterError.value = null;
        try {
            const updated = await apiUpdateCharacter(activeCharacterId.value, {
                name: editDraft.value.name,
                description: editDraft.value.description,
                personaPrompt: editDraft.value.personaPrompt,
                greetingMessage: editDraft.value.greetingMessage,
            });
            const idx = characters.value.findIndex(c => c.id === updated.id);
            if (idx !== -1) characters.value[idx] = updated;
        } catch (e) {
            characterError.value = e instanceof Error ? e.message : String(e);
        } finally {
            isSavingCharacter.value = false;
        }
    }

    // ── Delete ────────────────────────────────────────────────────────────────

    async function deleteCharacter(): Promise<void> {
        if (!activeCharacterId.value) return;
        const confirmDelete = window.confirm(
            `Delete character "${activeCharacter.value?.name ?? ""}"? This cannot be undone.`
        );
        if (!confirmDelete) return;

        isSavingCharacter.value = true;
        characterError.value = null;
        try {
            const deletedId = activeCharacterId.value;
            await apiDeleteCharacter(deletedId);
            characters.value = characters.value.filter(c => c.id !== deletedId);
            // Select the first remaining character, or clear
            const next = characters.value[0] ?? null;
            if (next) {
                await apiSetActiveCharacter(next.id);
                activeCharacterId.value = next.id;
            } else {
                activeCharacterId.value = null;
            }
            syncDraft();
        } catch (e) {
            characterError.value = e instanceof Error ? e.message : String(e);
        } finally {
            isSavingCharacter.value = false;
        }
    }

    return {
        // user
        userInfo, isLoadingUser, isSavingUser, userError,
        loadUserInfo, saveUserInfo,
        // character list
        characters, activeCharacterId, activeCharacter,
        editDraft,
        isLoadingCharacters, isSavingCharacter, characterError,
        isCreating, newName, newDescription, newPersonaPrompt, newGreetingMessage,
        loadCharacters,
        selectCharacter,
        openCreateForm, cancelCreate, createCharacter,
        saveCharacter,
        deleteCharacter,
    };
}
