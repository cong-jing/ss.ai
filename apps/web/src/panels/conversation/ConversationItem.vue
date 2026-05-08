<script setup lang="ts">
import type { ConversationInfo } from './conversationApi'

const props = defineProps<{
  conversation: ConversationInfo
  isActive: boolean
}>()

const emit = defineEmits<{
  select: []
  delete: []
}>()

function formatDate(iso: string): string {
    const d = new Date(iso)
    const now = new Date()
    const isToday = d.toDateString() === now.toDateString()
    if (isToday) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}
</script>

<template>
  <div
    class="conv-item"
    :class="{ 'conv-item--active': isActive }"
    @click="emit('select')"
  >
    <div class="conv-main">
      <span class="conv-title" :class="{ 'conv-title--empty': !conversation.title }">
        {{ conversation.title ?? 'New chat' }}
      </span>
      <span class="conv-date">{{ formatDate(conversation.updatedAt) }}</span>
    </div>
    <button
      class="conv-delete"
      title="Delete"
      @click.stop="emit('delete')"
    >✕</button>
  </div>
</template>

<style scoped>
.conv-item {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 8px 10px;
  border-radius: 6px;
  cursor: pointer;
  position: relative;
}

.conv-item:hover {
  background: #f3f4f6;
}

.conv-item--active {
  background: #eef2ff;
}

.conv-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.conv-title {
  font-size: 13px;
  color: #111827;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.conv-title--empty {
  color: #9ca3af;
}

.conv-date {
  font-size: 11px;
  color: #9ca3af;
}

.conv-delete {
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  border: none;
  background: none;
  cursor: pointer;
  color: #9ca3af;
  font-size: 11px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  opacity: 0;
  transition: opacity 0.1s;
}

.conv-item:hover .conv-delete {
  opacity: 1;
}

.conv-delete:hover {
  background: #fee2e2;
  color: #b91c1c;
}
</style>
