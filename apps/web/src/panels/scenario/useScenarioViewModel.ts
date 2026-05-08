import { ref } from "vue";
import { apiGetUserInfo, apiSaveUserInfo } from "./scenarioApi";
import type { UserInfo } from "./scenarioTypes";
import { useToast } from "../../shared/ui/useToast";

export function useScenarioViewModel() {
    const toast = useToast();
    const userInfo = ref<UserInfo>({ name: "", bio: "" });
    const isLoadingUser = ref(false);
    const isSavingUser = ref(false);

    async function loadUserInfo(): Promise<void> {
        isLoadingUser.value = true;
        try { userInfo.value = await apiGetUserInfo(); }
        catch (e) { toast.error(e instanceof Error ? e.message : String(e)); }
        finally { isLoadingUser.value = false; }
    }

    async function saveUserInfo(): Promise<void> {
        isSavingUser.value = true;
        try { userInfo.value = await apiSaveUserInfo(userInfo.value); }
        catch (e) { toast.error(e instanceof Error ? e.message : String(e)); }
        finally { isSavingUser.value = false; }
    }

    return { userInfo, isLoadingUser, isSavingUser, loadUserInfo, saveUserInfo };
}
