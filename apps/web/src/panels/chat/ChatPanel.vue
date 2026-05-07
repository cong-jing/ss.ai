<script setup lang="ts">
import { onMounted } from "vue";
import Button from "../../shared/ui/Button.vue";
import Panel from "../../shared/ui/Panel.vue";
import ChatInputBox from "./ChatInputBox.vue";
import ChatMessageList from "./ChatMessageList.vue";
import { useChatViewModel } from "./useChatViewModel";

const vm = useChatViewModel();
const { messages, isSending, error, showDebug, sendMessage, clearMessages, dryRunPrompt } = vm;

onMounted(() => {
  clearMessages();
});
</script>

<template>
  <Panel title="Chat" class="chat-panel" padding="none">
    <template #header-actions>
      <span v-if="isSending" class="sending">Sending...</span>
      <button class="header-btn" :class="{ active: showDebug }" @click="showDebug = !showDebug">
        {{ showDebug ? 'Hide Debug' : 'Show Debug' }}
      </button>
      <Button :disabled="isSending" @click="clearMessages">Clear</Button>
    </template>

    <div class="chat-layout">
      <div class="chat-messages">
        <ChatMessageList :messages="messages" :show-debug="showDebug" />
      </div>

      <p v-if="error" class="error">{{ error }}</p>

      <ChatInputBox
        :disabled="isSending"
        @send="(text, stream) => sendMessage(text, stream)"
        @dry-run="(text) => dryRunPrompt(text)"
      />
    </div>
  </Panel>
</template>

<style scoped>
.chat-panel {
  height: 100%;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.chat-layout {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.chat-messages {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: #f9fafb;
}

.sending {
  font-size: 12px;
  color: #6b7280;
}

.error {
  flex-shrink: 0;
  margin: 0;
  padding: 8px 12px;
  font-size: 12px;
  color: #b91c1c;
  background: #fee2e2;
}

.header-btn {
  font-size: 12px;
  color: #6b7280;
  background: none;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  padding: 2px 8px;
  cursor: pointer;
  line-height: 1.5;
}

.header-btn:hover {
  background: #f3f4f6;
}

.header-btn.active {
  background: #dbeafe;
  border-color: #93c5fd;
  color: #1d4ed8;
}
</style>
