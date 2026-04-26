<script setup lang="ts">
defineProps<{
  disabled?: boolean;
}>();
</script>

<template>
  <button class="btn" :disabled="disabled" type="button">
    <slot />
  </button>
</template>

<style scoped>
.btn {
  min-height: 34px;
  padding: 6px 12px;
  border: 1px solid #cfd5de;
  border-radius: 8px;
  background: #fff;
  cursor: pointer;
}

.btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
</style>
