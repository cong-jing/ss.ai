<script setup lang="ts">
defineProps<{
  disabled?: boolean;
  size?: "sm" | "md";
  variant?: "default" | "danger";
}>();
</script>

<template>
  <button class="btn" :class="[size === 'sm' ? 'btn--sm' : '', variant === 'danger' ? 'btn--danger' : '']" :disabled="disabled" type="button">
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
  font-family: inherit;
  font-size: 13px;
  white-space: nowrap;
}

.btn--sm {
  min-height: 26px;
  padding: 3px 8px;
  font-size: 12px;
  border-radius: 6px;
}

.btn--danger {
  border-color: #fca5a5;
  color: #b91c1c;
}

.btn--danger:hover:not(:disabled) {
  background: #fee2e2;
}

.btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
</style>
