<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import type { ConversationInfo } from './conversationApi'

const props = defineProps<{
  conversation: ConversationInfo
  isActive: boolean
}>()

const emit = defineEmits<{
  select: []
  delete: []
  rename: [title: string | null]
}>()

const isEditing = ref(false)
const titleDraft = ref(props.conversation.title ?? '')
const titleInputRef = ref<HTMLInputElement | null>(null)

watch(
  () => [props.conversation.id, props.conversation.title],
  () => {
    titleDraft.value = props.conversation.title ?? ''
    isEditing.value = false
  },
)

function formatDate(iso: string): string {
    const d = new Date(iso)
    const now = new Date()
    const isToday = d.toDateString() === now.toDateString()
    if (isToday) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

function startEdit() {
  isEditing.value = true
  titleDraft.value = props.conversation.title ?? ''
  void nextTick(() => titleInputRef.value?.focus())
}

function cancelEdit() {
  isEditing.value = false
  titleDraft.value = props.conversation.title ?? ''
}

function saveEdit() {
  emit('rename', titleDraft.value.trim() || null)
  isEditing.value = false
}
</script>

<template>
  <div
    class="conv-item"
    :class="{ 'conv-item--active': isActive }"
    @click="!isEditing && emit('select')"
  >
    <div class="conv-main">
      <div class="conv-title-row">
        <input
          v-if="isEditing"
          ref="titleInputRef"
          v-model="titleDraft"
          class="conv-title-input"
          @click.stop
          @keydown.enter.stop.prevent="saveEdit"
          @keydown.esc.stop.prevent="cancelEdit"
        />
        <span v-else class="conv-title" :class="{ 'conv-title--empty': !conversation.title }">
          {{ conversation.title ?? 'new chat' }}
        </span>

        <div class="conv-actions" @click.stop>
          <template v-if="isEditing">
            <button class="conv-edit" title="Save" @click.stop="saveEdit">保存</button>
            <button class="conv-edit" title="Cancel" @click.stop="cancelEdit">取消</button>
          </template>
          <template v-else>
            <button class="conv-edit" title="Edit" @click.stop="startEdit">编辑</button>
          </template>
        </div>
      </div>

      <div class="conv-meta-row">
        <span class="conv-date">{{ formatDate(conversation.updatedAt) }}</span>
        <span class="conv-id">{{ conversation.id }}</span>
      </div>
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
  gap: 8px;
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
  gap: 4px;
}

.conv-title-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.conv-actions {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 4px;
}

.conv-title-input {
  flex: 1;
  min-width: 0;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  padding: 2px 6px;
  font-size: 12px;
  font-family: inherit;
}

.conv-meta-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
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

.conv-id {
  font-size: 10px;
  color: #6b7280;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  user-select: text;
  word-break: break-all;
}

.conv-edit {
  flex-shrink: 0;
  border: 1px solid #d1d5db;
  background: #fff;
  color: #6b7280;
  font-size: 10px;
  border-radius: 4px;
  padding: 1px 6px;
  cursor: pointer;
}

.conv-edit:hover {
  background: #f3f4f6;
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
}

.conv-delete:hover {
  background: #fee2e2;
  color: #b91c1c;
}
</style>
