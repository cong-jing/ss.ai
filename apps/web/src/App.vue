<script setup lang="ts">
import { onMounted } from "vue";
import HomePage from "./pages/HomePage.vue";
import ToastContainer from "./shared/ui/ToastContainer.vue";
import AuthPage from "./auth/AuthPage.vue";
import { useAuthState } from "./auth/useAuthState";

const { isAuthLoading, authMode, isAuthenticated, authLoadError, refreshAuth } = useAuthState();

onMounted(() => {
  void refreshAuth();
});
</script>

<template>
  <main v-if="isAuthLoading" class="boot-screen">Loading...</main>
  <main v-else-if="authLoadError" class="boot-screen boot-screen-error">
    <section class="boot-card">
      <h1>Authentication Unavailable</h1>
      <p>{{ authLoadError }}</p>
      <button type="button" class="boot-retry" @click="refreshAuth()">Retry</button>
    </section>
  </main>
  <AuthPage v-else-if="authMode === 'local-password' && !isAuthenticated" />
  <HomePage v-else />
  <ToastContainer />
</template>

<style scoped>
.boot-screen {
  width: 100%;
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #4b5563;
  background: #f3f4f6;
}

.boot-screen-error {
  padding: 24px;
}

.boot-card {
  width: min(480px, 100%);
  background: #ffffff;
  border: 1px solid #d1d5db;
  border-radius: 12px;
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  box-shadow: 0 20px 45px rgba(15, 23, 42, 0.08);
}

.boot-card h1 {
  margin: 0;
  font-size: 20px;
  color: #111827;
}

.boot-card p {
  margin: 0;
  color: #4b5563;
}

.boot-retry {
  align-self: flex-start;
  border: 0;
  border-radius: 999px;
  background: #111827;
  color: #f9fafb;
  padding: 10px 18px;
  font: inherit;
  cursor: pointer;
}
</style>
