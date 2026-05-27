import { computed, ref } from "vue";
import type { AuthMode, AuthUserInfo } from "@ss-ai/contracts";
import { apiAuthLogin, apiAuthLogout, apiAuthMe, apiAuthRegister } from "./authApi";

const isAuthLoading = ref(true);
const authMode = ref<AuthMode>("default-user");
const allowRegistration = ref(true);
const isAuthenticated = ref(false);
const currentUser = ref<AuthUserInfo | null>(null);

export const currentUserId = computed<string | null>(() => currentUser.value?.id ?? null);

export function useAuthState() {
    async function refreshAuth(): Promise<void> {
        isAuthLoading.value = true;
        try {
            const me = await apiAuthMe();
            authMode.value = me.authMode;
            allowRegistration.value = me.allowRegistration;
            isAuthenticated.value = me.authenticated;
            currentUser.value = me.user;
        } finally {
            isAuthLoading.value = false;
        }
    }

    async function login(username: string, password: string): Promise<void> {
        const session = await apiAuthLogin(username, password);
        authMode.value = session.authMode;
        isAuthenticated.value = true;
        currentUser.value = session.user;
    }

    async function register(username: string, password: string, displayName?: string): Promise<void> {
        const session = await apiAuthRegister(username, password, displayName);
        authMode.value = session.authMode;
        isAuthenticated.value = true;
        currentUser.value = session.user;
    }

    async function logout(): Promise<void> {
        await apiAuthLogout();
        if (authMode.value === "local-password") {
            isAuthenticated.value = false;
            currentUser.value = null;
            return;
        }
        await refreshAuth();
    }

    return {
        isAuthLoading,
        authMode,
        allowRegistration,
        isAuthenticated,
        currentUser,
        refreshAuth,
        login,
        register,
        logout,
    };
}
