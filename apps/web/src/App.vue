<script setup lang="ts">
import HomePage from "./pages/HomePage.vue";
import DebugOverlay from "./shared/debug/DebugOverlay.vue";
import ToastContainer from "./shared/ui/ToastContainer.vue";

const showDebugOverlay = import.meta.env.DEV;
</script>

<template>
  <HomePage />
  <DebugOverlay v-if="showDebugOverlay" />
  <ToastContainer />
</template>
