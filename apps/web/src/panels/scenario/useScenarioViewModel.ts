import { ref } from "vue";
import { apiGetUserInfo, apiSaveUserInfo, apiGetCharacterInfo, apiSaveCharacterInfo } from "./scenarioApi";
import type { UserInfo, CharacterInfo } from "./scenarioTypes";

export function useScenarioViewModel() {
    const userInfo = ref<UserInfo>({ name: "", bio: "" });
    const characterInfo = ref<CharacterInfo>({ name: "", description: "" });

    const isLoadingUser = ref(false);
    const isSavingUser = ref(false);
    const userError = ref<string | null>(null);

    const isLoadingCharacter = ref(false);
    const isSavingCharacter = ref(false);
    const characterError = ref<string | null>(null);

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

    async function loadCharacterInfo(): Promise<void> {
        isLoadingCharacter.value = true;
        characterError.value = null;
        try {
            characterInfo.value = await apiGetCharacterInfo();
        } catch (e) {
            characterError.value = e instanceof Error ? e.message : String(e);
        } finally {
            isLoadingCharacter.value = false;
        }
    }

    async function saveCharacterInfo(): Promise<void> {
        isSavingCharacter.value = true;
        characterError.value = null;
        try {
            characterInfo.value = await apiSaveCharacterInfo(characterInfo.value);
        } catch (e) {
            characterError.value = e instanceof Error ? e.message : String(e);
        } finally {
            isSavingCharacter.value = false;
        }
    }

    return {
        userInfo,
        characterInfo,
        isLoadingUser,
        isSavingUser,
        userError,
        isLoadingCharacter,
        isSavingCharacter,
        characterError,
        loadUserInfo,
        saveUserInfo,
        loadCharacterInfo,
        saveCharacterInfo
    };
}
