<script setup lang="ts">
import type { ChatMessage } from "./chatTypes";

defineProps<{
  message: ChatMessage;
}>();
</script>

<template>
  <!-- Debug message: expandable prompt preview -->
  <article v-if="message.role === 'debug'" class="message-block role-debug">
    <details>
      <summary class="debug-summary">
        <span>Prompt Preview</span>
        <span class="debug-count">{{ message.debugMessages?.length ?? 0 }} messages</span>
        <time v-if="message.createdAt" class="debug-time">{{ new Date(message.createdAt).toLocaleTimeString() }}</time>
      </summary>
      <div class="debug-body">
        <div
          v-for="(m, i) in message.debugMessages"
          :key="i"
          class="debug-msg"
          :class="`debug-role-${m.role}`"
        >
          <span class="debug-role-label">{{ m.role }}</span>
          <pre class="debug-content">{{ m.content }}</pre>
        </div>
      </div>
    </details>
  </article>

  <!-- Normal message -->
  <article v-else class="message-block" :class="[`role-${message.role}`, `status-${message.status ?? 'normal'}`]">
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

.role-debug {
  width: 100%;
  max-width: 100%;
  margin: 0;
  border-color: #d1fae5;
  background: #f0fdf4;
  border-radius: 8px;
  padding: 0;
  overflow: hidden;
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

/* Debug styles */
.debug-summary {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  font-size: 12px;
  font-weight: 500;
  color: #065f46;
  cursor: pointer;
  user-select: none;
  list-style: none;
}

.debug-summary::-webkit-details-marker { display: none; }

details[open] .debug-summary {
  border-bottom: 1px solid #d1fae5;
}

.debug-count {
  font-weight: normal;
  color: #6b7280;
  font-size: 11px;
}

.debug-time {
  margin-left: auto;
  font-weight: normal;
  color: #9ca3af;
  font-size: 11px;
}

.debug-body {
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.debug-msg {
  border-radius: 6px;
  overflow: hidden;
  border: 1px solid #d1fae5;
}

.debug-role-label {
  display: block;
  padding: 2px 8px;
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  background: #d1fae5;
  color: #065f46;
}

.debug-role-user .debug-role-label {
  background: #dbeafe;
  color: #1e40af;
  border-bottom: 1px solid #bfdbfe;
}

.debug-role-assistant .debug-role-label {
  background: #ede9fe;
  color: #5b21b6;
  border-bottom: 1px solid #ddd6fe;
}

.debug-content {
  margin: 0;
  padding: 6px 8px;
  font-size: 12px;
  font-family: ui-monospace, monospace;
  white-space: pre-wrap;
  word-break: break-word;
  background: #fff;
  color: #374151;
  line-height: 1.5;
}
</style>
