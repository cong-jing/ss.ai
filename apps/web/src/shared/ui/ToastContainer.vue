<script setup lang="ts">
import { toasts, useToast } from './useToast'

const { dismiss } = useToast()
</script>

<template>
  <Teleport to="body">
    <div class="toast-container" aria-live="polite">
      <div
        v-for="t in toasts"
        :key="t.id"
        class="toast"
        :class="`toast--${t.type}`"
        role="alert"
        @click="dismiss(t.id)"
      >
        <span class="toast-icon">
          <template v-if="t.type === 'error'">✕</template>
          <template v-else-if="t.type === 'success'">✓</template>
          <template v-else>ℹ</template>
        </span>
        <span class="toast-message">{{ t.message }}</span>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.toast-container {
  position: fixed;
  bottom: 16px;
  left: 16px;
  z-index: 2000;
  display: flex;
  flex-direction: column-reverse;
  gap: 8px;
  pointer-events: none;
}

.toast {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 10px 14px;
  border-radius: 8px;
  font-size: 13px;
  max-width: 360px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
  cursor: pointer;
  pointer-events: all;
  line-height: 1.4;
}

.toast--error {
  background: #fef2f2;
  border: 1px solid #fca5a5;
  color: #b91c1c;
}

.toast--success {
  background: #f0fdf4;
  border: 1px solid #86efac;
  color: #15803d;
}

.toast--info {
  background: #f0f9ff;
  border: 1px solid #7dd3fc;
  color: #0369a1;
}

.toast-icon {
  flex-shrink: 0;
  font-size: 11px;
  font-weight: 700;
  margin-top: 1px;
}

.toast-message {
  flex: 1;
  word-break: break-word;
}
</style>
