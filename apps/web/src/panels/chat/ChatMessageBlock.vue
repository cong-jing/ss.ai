<script setup lang="ts">
import { ref } from "vue";
import type { ChatMessage } from "./chatTypes";

const props = defineProps<{
  message: ChatMessage;
  showDebug?: boolean;
}>();

const emit = defineEmits<{
  deleteMessage: [messageId: string];
}>();

const showPrompt = ref(false);

function handleDeleteMessage() {
  if (!props.message.id) return;
  emit("deleteMessage", props.message.id);
}

function sourceTypeLabel(sourceType: ChatMessage["senderSourceType"]): string {
  switch (sourceType) {
    case "logged_user":
      return "logged user";
    case "local_actor":
      return "local actor";
    case "ai_character":
      return "ai character";
    case "system":
      return "system";
    default:
      return "";
  }
}
</script>

<template>
  <!-- Debug message: expandable prompt preview -->
  <article v-if="message.role === 'debug'" class="message-block role-debug">
    <div v-if="showDebug && message.id" class="message-id-row">id: {{ message.id }}</div>
    <details>
      <summary class="debug-summary">
        <span>{{ message.structuredDecision ? 'Structured Decision' : 'Prompt Preview' }}</span>
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
    <div v-if="showDebug && message.id" class="message-id-row">id: {{ message.id }}</div>
    <header class="message-meta">
      <span class="sender-meta">
        <span class="sender-name">{{ message.senderDisplayName ?? message.role }}</span>
        <span v-if="message.senderSourceType" class="source-badge">{{ sourceTypeLabel(message.senderSourceType) }}</span>
      </span>
      <div class="message-meta-right">
        <button
          class="delete-msg-btn"
          :disabled="message.deleting || !message.id"
          @click="handleDeleteMessage"
        >
          {{ message.deleting ? 'Deleting...' : 'Delete' }}
        </button>
        <button
          v-if="message.role === 'assistant' && message.promptMessages"
          class="view-prompt-btn"
          :class="{ active: showPrompt }"
          @click="showPrompt = !showPrompt"
        >
          {{ showPrompt ? 'Hide Prompt' : 'View Prompt' }}
        </button>
        <time v-if="message.createdAt">{{ new Date(message.createdAt).toLocaleTimeString() }}</time>
      </div>
    </header>
    <p class="message-content">{{ message.content }}</p>
    <div v-if="showPrompt && message.promptMessages" class="prompt-expand">
      <div
        v-for="(m, i) in message.promptMessages"
        :key="i"
        class="debug-msg"
        :class="`debug-role-${m.role}`"
      >
        <span class="debug-role-label">{{ m.role }}</span>
        <pre class="debug-content">{{ m.content }}</pre>
      </div>
    </div>
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

.message-id-row {
  margin-bottom: 6px;
  font-size: 10px;
  color: #6b7280;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  user-select: text;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.role-debug .message-id-row {
  margin: 6px 10px 0;
}

.message-meta {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  font-size: 11px;
  color: #6b7280;
  margin-bottom: 4px;
  align-items: center;
}

.sender-meta {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.sender-name {
  color: #4b5563;
}

.source-badge {
  font-size: 10px;
  line-height: 1;
  color: #1f2937;
  background: #e5e7eb;
  border-radius: 999px;
  padding: 2px 6px;
}

.message-meta-right {
  display: flex;
  align-items: center;
  gap: 6px;
}

.view-prompt-btn {
  font-size: 10px;
  color: #6b7280;
  background: none;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  padding: 1px 6px;
  cursor: pointer;
  line-height: 1.5;
  transition: background 0.15s, border-color 0.15s;
}

.delete-msg-btn {
  font-size: 10px;
  color: #991b1b;
  background: #fff;
  border: 1px solid #fecaca;
  border-radius: 4px;
  padding: 1px 6px;
  cursor: pointer;
  line-height: 1.5;
  transition: background 0.15s, border-color 0.15s;
}

.delete-msg-btn:hover {
  background: #fef2f2;
  border-color: #fca5a5;
}

.delete-msg-btn:disabled {
  opacity: 0.6;
  cursor: default;
}

.view-prompt-btn:hover {
  background: #f3f4f6;
  border-color: #9ca3af;
}

.view-prompt-btn.active {
  background: #eff6ff;
  border-color: #93c5fd;
  color: #1d4ed8;
}

.prompt-expand {
  margin-top: 8px;
  border-top: 1px solid #e5e7eb;
  padding-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
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
