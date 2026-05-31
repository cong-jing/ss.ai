import { ref } from "vue";
import { apiGetUserProfileInfo, apiSaveUserProfileInfo } from "./userProfileApi";
import type { UserProfileInfo } from "./userProfileTypes";
import { localizeApiError } from "../../shared/api/localizeApiError";
import { useToast } from "../../shared/ui/useToast";

export function useUserProfileViewModel() {
    const toast = useToast();
    const userInfo = ref<UserProfileInfo>({ name: "", bio: "" });
    const isLoadingUser = ref(false);
    const isSavingUser = ref(false);

    async function loadUserInfo(): Promise<void> {
        isLoadingUser.value = true;
        try {
            userInfo.value = await apiGetUserProfileInfo();
        } catch (e) {
            toast.error(localizeApiError(e));
        } finally {
            isLoadingUser.value = false;
        }
    }

    async function saveUserInfo(): Promise<void> {
        isSavingUser.value = true;
        try {
            userInfo.value = await apiSaveUserProfileInfo(userInfo.value);
        } catch (e) {
            toast.error(localizeApiError(e));
        } finally {
            isSavingUser.value = false;
        }
    }

    return { userInfo, isLoadingUser, isSavingUser, loadUserInfo, saveUserInfo };
}
