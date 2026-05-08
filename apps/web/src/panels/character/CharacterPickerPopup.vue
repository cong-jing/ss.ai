<script setup lang="ts">
import PopupWindow from '../../shared/ui/PopupWindow.vue'
import Button from '../../shared/ui/Button.vue'
import { useCharacterViewModel } from './useCharacterViewModel'

const model = defineModel<boolean>({ required: true })
const emit = defineEmits<{ 'new-character': [] }>()

const { characters, activeCharacterId, isLoadingCharacters, isSavingCharacter, select } =
    useCharacterViewModel()

function initials(name: string): string {
    return name.trim().slice(0, 2).toUpperCase()
}

async function onSelect(id: string) {
    await select(id)
    model.value = false
}
</script>

<template>
  <PopupWindow v-model="model" title="Characters" :modal="true" width="360px">
    <div class="picker-body">
      <p v-if="isLoadingCharacters" class="hint">Loading…</p>
      <p v-else-if="characters.length === 0" class="hint">No characters yet.</p>

      <div v-else class="character-list">
        <button
          v-for="c in characters"
          :key="c.id"
          class="character-item"
          :class="{ 'character-item--active': c.id === activeCharacterId }"
          :disabled="isSavingCharacter"
          @click="onSelect(c.id)"
        >
          <div class="item-avatar">{{ initials(c.name) }}</div>
          <div class="item-info">
            <div class="item-name">{{ c.name }}</div>
            <div v-if="c.description" class="item-desc">{{ c.description }}</div>
          </div>
          <span v-if="c.id === activeCharacterId" class="item-badge">Active</span>
        </button>
      </div>
    </div>

    <template #footer>
      <Button size="sm" @click="emit('new-character')">+ New character</Button>
    </template>
  </PopupWindow>
</template>

<style scoped>
.picker-body {
  min-height: 80px;
}

.hint {
  margin: 0;
  font-size: 13px;
  color: #9ca3af;
}

.character-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.character-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: none;
  cursor: pointer;
  text-align: left;
  width: 100%;
  font-family: inherit;
}

.character-item:hover:not(:disabled) {
  background: #f3f4f6;
}

.character-item--active {
  border-color: #c7d2fe;
  background: #eef2ff;
}

.item-avatar {
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  border-radius: 6px;
  background: #e0e7ff;
  color: #4338ca;
  font-size: 12px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
}

.item-info {
  flex: 1;
  min-width: 0;
}

.item-name {
  font-size: 13px;
  font-weight: 600;
  color: #111827;
}

.item-desc {
  font-size: 11px;
  color: #6b7280;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.item-badge {
  font-size: 10px;
  color: #4338ca;
  background: #e0e7ff;
  padding: 2px 6px;
  border-radius: 10px;
  flex-shrink: 0;
}
</style>
