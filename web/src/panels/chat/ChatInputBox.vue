<script setup lang="ts">
import { ref } from "vue";
import Button from "../../shared/ui/Button.vue";

const props = defineProps<{
  disabled?: boolean;
}>();

const emit = defineEmits<{
  send: [text: string];
}>();

const text = ref("");

function submit() {
  const value = text.value.trim();
  if (!value || props.disabled) {
    return;
  }

  emit("send", value);
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
    <Button :disabled="disabled" @click="submit">Send</Button>
  </footer>
</template>

<style scoped>
.chat-input-box {
  display: flex;
  gap: 8px;
  padding: 10px 12px;
  border-top: 1px solid #e5e7eb;
  background: #fff;
}

.chat-input {
  flex: 1;
  min-height: 68px;
  border: 1px solid #d1d5db;
  border-radius: 8px;
  padding: 8px;
  resize: vertical;
  font: inherit;
}
</style>
