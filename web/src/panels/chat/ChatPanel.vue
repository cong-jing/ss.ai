<script setup lang="ts">
import { onMounted } from "vue";
import Button from "../../shared/ui/Button.vue";
import Panel from "../../shared/ui/Panel.vue";
import ChatInputBox from "./ChatInputBox.vue";
import ChatMessageList from "./ChatMessageList.vue";
import { useChatViewModel } from "./useChatViewModel";

const vm = useChatViewModel();
const { messages, isSending, error, sendMessage, clearMessages } = vm;

onMounted(() => {
  clearMessages();
});
</script>

<template>
  <Panel title="Chat" class="chat-panel">
    <div class="chat-layout">
      <div class="chat-actions">
        <Button :disabled="isSending" @click="clearMessages">清空消息</Button>
        <span v-if="isSending" class="sending">发送中...</span>
      </div>

      <div class="chat-messages">
        <ChatMessageList :messages="messages" />
      </div>

      <p v-if="error" class="error">{{ error }}</p>

      <ChatInputBox :disabled="isSending" @send="sendMessage" />
    </div>
  </Panel>
</template>

<style scoped>
.chat-panel {
  height: 100%;
}

.chat-layout {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.chat-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid #e5e7eb;
  background: #fff;
}

.chat-messages {
  flex: 1;
  min-height: 0;
  background: #f9fafb;
}

.sending {
  font-size: 12px;
  color: #6b7280;
}

.error {
  margin: 0;
  padding: 8px 12px;
  font-size: 12px;
  color: #b91c1c;
  background: #fee2e2;
}
</style>
