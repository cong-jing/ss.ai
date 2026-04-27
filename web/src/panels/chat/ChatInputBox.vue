<script setup lang="ts">
import { ref } from "vue";
import Button from "../../shared/ui/Button.vue";

const props = defineProps<{
  disabled?: boolean;
}>();

const emit = defineEmits<{
  send: [text: string, stream: boolean];
}>();

const text = ref("");
const streamMode = ref(false);

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
    <div class="input-row">
      <textarea
        v-model="text"
        :disabled="disabled"
        class="chat-input"
        placeholder="Input message, Enter to send, Shift+Enter for newline"
        @keydown="onKeydown"
      />
      <Button :disabled="disabled" @click="submit">Send</Button>
    </div>
    <label class="stream-toggle">
      <input type="checkbox" v-model="streamMode" :disabled="disabled" />
      Stream
    </label>
  </footer>
</template>

<style scoped>
.chat-input-box {
  display: flex;
  flex: 0 0 auto;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px;
  border-top: 1px solid #e5e7eb;
  background: #fff;
}

.input-row {
  display: flex;
  gap: 8px;
}

.chat-input {
  flex: 1 1 auto;
  min-height: 68px;
  border: 1px solid #d1d5db;
  border-radius: 8px;
  padding: 8px;
  resize: vertical;
  font: inherit;
}

.stream-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: #6b7280;
  cursor: pointer;
  user-select: none;
}
</style>
