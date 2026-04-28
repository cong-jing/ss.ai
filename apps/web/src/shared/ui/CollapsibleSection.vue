<script setup lang="ts">
import { ref } from "vue";

defineProps<{
  title: string;
  defaultOpen?: boolean;
}>();

const open = ref(true);
</script>

<template>
  <div class="collapsible-section">
    <button class="collapsible-header" @click="open = !open">
      <span class="collapsible-title">{{ title }}</span>
      <span class="collapsible-icon">{{ open ? '▾' : '▸' }}</span>
    </button>
    <div v-show="open" class="collapsible-body">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.collapsible-section {
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  overflow: hidden;
}

.collapsible-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 10px 12px;
  background: #f9fafb;
  border: none;
  cursor: pointer;
  text-align: left;
  font-family: inherit;
}

.collapsible-header:hover {
  background: #f3f4f6;
}

.collapsible-title {
  font-size: 13px;
  font-weight: 600;
  color: #374151;
}

.collapsible-icon {
  font-size: 12px;
  color: #6b7280;
}

.collapsible-body {
  padding: 12px;
  border-top: 1px solid #e5e7eb;
  background: #fff;
}
</style>
