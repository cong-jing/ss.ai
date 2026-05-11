<script setup lang="ts">
import type { ConversationInfo } from "../../conversation/conversationApi";
import ConversationItem from "../../conversation/ConversationItem.vue";

defineProps<{
  isOpen: boolean;
  activeCharacterId: string | null;
  isLoadingConversations: boolean;
  conversations: ConversationInfo[];
  activeConversationId: string | null;
}>();

const emit = defineEmits<{
  "conversation:toggle-open": [];
  "conversation:create": [];
  "conversation:select": [id: string];
  "conversation:rename": [conversationId: string, title: string | null];
  "conversation:delete": [id: string];
}>();
</script>

<template>
  <section class="group group--conversation">
    <button class="group-header" @click="emit('conversation:toggle-open')">
      <span>对话</span>
      <span>{{ isOpen ? "▾" : "▸" }}</span>
    </button>

    <div v-if="isOpen" class="group-body">
      <div class="row-inline">
        <button class="mini-btn" :disabled="isLoadingConversations || !activeCharacterId" @click="emit('conversation:create')">+ 新建</button>
        <span v-if="isLoadingConversations" class="hint">加载中...</span>
      </div>

      <p v-if="!activeCharacterId" class="hint">请先选择角色。</p>
      <p v-else-if="conversations.length === 0" class="hint">暂无对话。</p>

      <ConversationItem
        v-for="conv in conversations"
        :key="conv.id"
        :conversation="conv"
        :is-active="conv.id === activeConversationId"
        @select="emit('conversation:select', conv.id)"
        @rename="emit('conversation:rename', conv.id, $event)"
        @delete="emit('conversation:delete', conv.id)"
      />
    </div>
  </section>
</template>

<style scoped>
.group {
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  overflow: hidden;
  background: #fff;
}

.group-header {
  width: 100%;
  border: none;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  padding: 8px 10px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  cursor: pointer;
  background: #ecfeff;
  color: #0f766e;
}

.group-body {
  padding: 8px 8px 8px 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  border-left: 2px solid #99f6e4;
}

.row-inline {
  display: flex;
  align-items: center;
  gap: 6px;
}

.hint {
  margin: 0;
  font-size: 11px;
  color: #9ca3af;
}

.mini-btn {
  border: 1px solid #d1d5db;
  background: #fff;
  border-radius: 6px;
  padding: 3px 8px;
  font-size: 11px;
  color: #374151;
  cursor: pointer;
}

.mini-btn:disabled {
  opacity: 0.5;
  cursor: default;
}
</style>
