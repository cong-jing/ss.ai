<script setup lang="ts">
import { onMounted } from "vue";
import HomePage from "./pages/HomePage.vue";
import DebugOverlay from "./shared/debug/DebugOverlay.vue";
import ToastContainer from "./shared/ui/ToastContainer.vue";
import AuthPage from "./auth/AuthPage.vue";
import { useAuthState } from "./auth/useAuthState";

const showDebugOverlay = import.meta.env.DEV;
const { isAuthLoading, authMode, isAuthenticated, refreshAuth } = useAuthState();

onMounted(() => {
  void refreshAuth();
});
</script>

<template>
  <main v-if="isAuthLoading" class="boot-screen">Loading...</main>
  <AuthPage v-else-if="authMode === 'local-password' && !isAuthenticated" />
  <HomePage v-else />
  <DebugOverlay v-if="showDebugOverlay" />
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
</style>
