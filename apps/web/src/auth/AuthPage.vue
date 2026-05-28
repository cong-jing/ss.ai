<script setup lang="ts">
import { computed, ref } from "vue";
import Button from "../shared/ui/Button.vue";
import TextInput from "../shared/ui/TextInput.vue";
import { useAuthState } from "./useAuthState";
import { useToast } from "../shared/ui/useToast";
import { t } from "../shared/i18n/i18n";

const { allowRegistration, login, register } = useAuthState();
const toast = useToast();

const tab = ref<"login" | "register">("login");
const username = ref("");
const password = ref("");
const displayName = ref("");
const isSubmitting = ref(false);

const usernameInputId = "auth-username";
const displayNameInputId = "auth-display-name";
const passwordInputId = "auth-password";

const canSwitchToRegister = computed(() => allowRegistration.value);

async function onSubmit(): Promise<void> {
    if (isSubmitting.value) return;
    isSubmitting.value = true;
    try {
        if (tab.value === "login") {
            await login(username.value, password.value);
        } else {
            await register(username.value, password.value, displayName.value);
        }
        password.value = "";
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        toast.error(message);
    } finally {
        isSubmitting.value = false;
    }
}

function switchTab(next: "login" | "register"): void {
    if (next === "register" && !canSwitchToRegister.value) return;
    tab.value = next;
}
</script>

<template>
  <main class="auth-page">
    <section class="auth-panel">
      <div class="auth-tabs">
        <Button :variant="tab === 'login' ? 'primary' : 'default'" @click="switchTab('login')">
          {{ t("auth.login") }}
        </Button>
        <Button :variant="tab === 'register' ? 'primary' : 'default'" :disabled="!canSwitchToRegister" @click="switchTab('register')">
          {{ t("auth.register") }}
        </Button>
      </div>

      <form class="auth-form" @submit.prevent="onSubmit">
        <label class="auth-label" :for="usernameInputId">{{ t("auth.username") }}</label>
        <TextInput :id="usernameInputId" v-model="username" autocomplete="username" />

        <label v-if="tab === 'register'" class="auth-label" :for="displayNameInputId">{{ t("auth.displayName") }}</label>
        <TextInput v-if="tab === 'register'" :id="displayNameInputId" v-model="displayName" autocomplete="nickname" />

        <label class="auth-label" :for="passwordInputId">{{ t("auth.password") }}</label>
        <TextInput :id="passwordInputId" v-model="password" type="password" autocomplete="current-password" />

        <Button type="submit" variant="primary" :disabled="isSubmitting">
          {{ tab === "login" ? t("auth.signIn") : t("auth.createAccount") }}
        </Button>
      </form>
    </section>
  </main>
</template>

<style scoped>
.auth-page {
  width: 100%;
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(160deg, #f3f4f6 0%, #e5e7eb 100%);
  padding: 24px;
}

.auth-panel {
  width: min(420px, 100%);
  border: 1px solid #d1d5db;
  border-radius: 8px;
  background: #fff;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.auth-tabs {
  display: flex;
  gap: 8px;
}

.auth-form {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.auth-label {
  font-size: 13px;
  color: #374151;
}
</style>
