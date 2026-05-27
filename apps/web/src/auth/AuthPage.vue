<script setup lang="ts">
import { computed, ref } from "vue";
import Button from "../shared/ui/Button.vue";
import TextInput from "../shared/ui/TextInput.vue";
import { useAuthState } from "./useAuthState";
import { useToast } from "../shared/ui/useToast";

const { allowRegistration, login, register } = useAuthState();
const toast = useToast();

const tab = ref<"login" | "register">("login");
const username = ref("");
const password = ref("");
const displayName = ref("");
const isSubmitting = ref(false);

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
          Login
        </Button>
        <Button :variant="tab === 'register' ? 'primary' : 'default'" :disabled="!canSwitchToRegister" @click="switchTab('register')">
          Register
        </Button>
      </div>

      <div class="auth-form">
        <label class="auth-label">Username</label>
        <TextInput v-model="username" autocomplete="username" />

        <label v-if="tab === 'register'" class="auth-label">Display Name</label>
        <TextInput v-if="tab === 'register'" v-model="displayName" autocomplete="nickname" />

        <label class="auth-label">Password</label>
        <TextInput v-model="password" type="password" autocomplete="current-password" />

        <Button variant="primary" :disabled="isSubmitting" @click="onSubmit">
          {{ tab === "login" ? "Sign In" : "Create Account" }}
        </Button>
      </div>
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
