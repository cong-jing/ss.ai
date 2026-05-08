<script setup lang="ts">
import { onMounted, watch } from 'vue'
import ConversationItem from './ConversationItem.vue'
import { useConversationViewModel } from './useConversationViewModel'
import { activeCharacterId } from '../character/useCharacterViewModel'

const {
    conversations, activeConversationId, isLoadingConversations,
    load, createConversation, selectConversation, deleteConversation,
} = useConversationViewModel()

onMounted(() => {
    if (activeCharacterId.value) void load()
})

// Reload when character changes
watch(activeCharacterId, (id) => {
    if (id) void load()
    else {
        conversations.value = []
        activeConversationId.value = null
    }
})
</script>

<template>
  <div class="conv-list">
    <div class="conv-list-header">
      <span class="conv-list-title">Conversations</span>
      <button
        class="new-btn"
        :disabled="isLoadingConversations || !activeCharacterId"
        @click="createConversation"
      >＋</button>
    </div>

    <div class="conv-list-body">
      <p v-if="isLoadingConversations" class="hint">Loading…</p>
      <p v-else-if="!activeCharacterId" class="hint">Select a character first.</p>
      <p v-else-if="conversations.length === 0" class="hint">No conversations yet.</p>

      <ConversationItem
        v-for="conv in conversations"
        :key="conv.id"
        :conversation="conv"
        :is-active="conv.id === activeConversationId"
        @select="selectConversation(conv.id)"
        @delete="deleteConversation(conv.id)"
      />
    </div>
  </div>
</template>

<style scoped>
.conv-list {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.conv-list-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 12px 8px;
  flex-shrink: 0;
  border-bottom: 1px solid #e5e7eb;
}

.conv-list-title {
  font-size: 12px;
  font-weight: 600;
  color: #6b7280;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.new-btn {
  width: 24px;
  height: 24px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  background: #fff;
  cursor: pointer;
  font-size: 16px;
  line-height: 1;
  color: #374151;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
}

.new-btn:hover:not(:disabled) {
  background: #f3f4f6;
}

.new-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.conv-list-body {
  flex: 1;
  overflow-y: auto;
  padding: 6px 6px;
}

.hint {
  margin: 8px 4px;
  font-size: 12px;
  color: #9ca3af;
}
</style>
