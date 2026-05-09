<script setup lang="ts">
import { ref } from "vue";
import Button from "../../shared/ui/Button.vue";
import { useLocalStorage } from "../../shared/ui/useLocalStorage";

const props = defineProps<{
  disabled?: boolean;
}>();

const emit = defineEmits<{
  send: [text: string, stream: boolean];
  dryRun: [text: string];
}>();

const text = ref("");
const streamMode = useLocalStorage("chat.streamMode", false);

function submit() {
  const value = text.value.trim();
  if (!value || props.disabled) {
    return;
  }

  emit("send", value, streamMode.value);
  text.value = "";
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    submit();
  }
}
</script>

<template>
  <footer class="chat-input-box">
    <textarea
      v-model="text"
      :disabled="disabled"
      class="chat-input"
      placeholder="Input message, Enter to send, Shift+Enter for newline"
      @keydown="onKeydown"
    />
    <div class="toolbar">
      <label class="stream-toggle">
        <input type="checkbox" v-model="streamMode" :disabled="disabled" />
        Stream
      </label>
      <div class="toolbar-right">
        <button class="dry-run-btn" :disabled="disabled" @click="emit('dryRun', text)">
          Dry Run
        </button>
        <Button :disabled="disabled" @click="submit">Send</Button>
      </div>
    </div>
  </footer>
</template>

<style scoped>
.chat-input-box {
  display: flex;
  flex: 0 0 auto;
  flex-direction: column;
  gap: 6px;
  padding: 8px 12px 10px;
  border-top: 1px solid #e5e7eb;
  background: #fff;
}

.chat-input {
  width: 100%;
  min-height: 68px;
  border: 1px solid #d1d5db;
  border-radius: 8px;
  padding: 8px;
  resize: vertical;
  font: inherit;
  box-sizing: border-box;
}

.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.stream-toggle {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  color: #6b7280;
  cursor: pointer;
  user-select: none;
}

.toolbar-right {
  display: flex;
  align-items: center;
  gap: 6px;
}

.dry-run-btn {
  font-size: 12px;
  color: #6b7280;
  background: none;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  padding: 3px 10px;
  cursor: pointer;
  line-height: 1.5;
}

.dry-run-btn:hover:not(:disabled) {
  background: #f3f4f6;
}

.dry-run-btn:disabled {
  opacity: 0.4;
  cursor: default;
}
</style>
