<script setup lang="ts">
import type { ChatMessage } from "./chatTypes";

defineProps<{
  message: ChatMessage;
}>();
</script>

<template>
  <article class="message-block" :class="[`role-${message.role}`, `status-${message.status ?? 'normal'}`]">
    <header class="message-meta">
      <span>{{ message.role }}</span>
      <time v-if="message.createdAt">{{ new Date(message.createdAt).toLocaleTimeString() }}</time>
    </header>
    <p class="message-content">{{ message.content }}</p>
  </article>
</template>

<style scoped>
.message-block {
  max-width: 72%;
  border: 1px solid #dbe1e7;
  border-radius: 10px;
  padding: 8px 10px;
  background: #fff;
}

.role-user {
  margin-left: auto;
  background: #dbeafe;
}

.role-assistant {
  margin-right: auto;
}

.role-system {
  margin: 0 auto;
  background: #f3f4f6;
}

.status-failed {
  border-color: #ef4444;
  background: #fee2e2;
}

.message-meta {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  font-size: 11px;
  color: #6b7280;
  margin-bottom: 4px;
}

.message-content {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 14px;
}
</style>
