import { computed, ref } from "vue";
import type { AuthMode, AuthUserInfo } from "@ss-ai/contracts";
import { apiAuthLogin, apiAuthLogout, apiAuthMe, apiAuthRegister } from "./authApi";

const isAuthLoading = ref(true);
const authMode = ref<AuthMode | null>(null);
const allowRegistration = ref(true);
const isAuthenticated = ref(false);
const currentUser = ref<AuthUserInfo | null>(null);
const authLoadError = ref<string | null>(null);

export const currentUserId = computed<string | null>(() => currentUser.value?.id ?? null);

export function useAuthState() {
    async function refreshAuth(): Promise<void> {
        isAuthLoading.value = true;
        try {
            const me = await apiAuthMe();
            authLoadError.value = null;
            authMode.value = me.authMode;
            allowRegistration.value = me.allowRegistration;
            isAuthenticated.value = me.authenticated;
            currentUser.value = me.user;
        } catch (error) {
            authLoadError.value = error instanceof Error ? error.message : String(error);
            isAuthenticated.value = false;
            currentUser.value = null;
        } finally {
            isAuthLoading.value = false;
        }
    }

    async function login(username: string, password: string): Promise<void> {
        const session = await apiAuthLogin(username, password);
        authLoadError.value = null;
        authMode.value = session.authMode;
        isAuthenticated.value = true;
        currentUser.value = session.user;
    }

    async function register(username: string, password: string, displayName?: string): Promise<void> {
        const session = await apiAuthRegister(username, password, displayName);
        authLoadError.value = null;
        authMode.value = session.authMode;
        isAuthenticated.value = true;
        currentUser.value = session.user;
    }

    async function logout(): Promise<void> {
        await apiAuthLogout();
        if (authMode.value === "local-password") {
            authLoadError.value = null;
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
        authLoadError,
        refreshAuth,
        login,
        register,
        logout,
    };
}
