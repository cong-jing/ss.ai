<script setup lang="ts">
import { ref } from 'vue'
import { useCharacterViewModel } from './useCharacterViewModel'
import CharacterPickerPopup from './CharacterPickerPopup.vue'
import CharacterEditPopup from './CharacterEditPopup.vue'

const { activeCharacter, isLoadingCharacters } = useCharacterViewModel()

const showPicker = ref(false)
const showEdit = ref(false)
const editMode = ref<'create' | 'edit'>('edit')

function openEdit() {
    editMode.value = 'edit'
    showEdit.value = true
}

function onNewCharacter() {
    showPicker.value = false
    editMode.value = 'create'
    showEdit.value = true
}

function initials(name: string): string {
    return name.trim().slice(0, 2).toUpperCase()
}
</script>

<template>
  <div class="character-card">
    <div v-if="isLoadingCharacters" class="card-loading">Loading character…</div>

    <template v-else-if="activeCharacter">
      <div class="card-body">
        <div class="card-avatar">{{ initials(activeCharacter.name) }}</div>
        <div class="card-info">
          <div class="card-name">{{ activeCharacter.name }}</div>
          <div v-if="activeCharacter.description" class="card-desc">
            {{ activeCharacter.description }}
          </div>
        </div>
      </div>
      <div class="card-actions">
        <button class="card-btn" @click="showPicker = true">Change</button>
        <button class="card-btn" @click="openEdit">Edit</button>
      </div>
    </template>

    <div v-else class="card-empty">
      <span class="card-empty-text">No character</span>
      <button class="card-btn" @click="onNewCharacter">+ Create</button>
    </div>
  </div>

  <CharacterPickerPopup
    v-model="showPicker"
    @new-character="onNewCharacter"
  />
  <CharacterEditPopup
    v-model="showEdit"
    :mode="editMode"
    @saved="showEdit = false"
  />
</template>

<style scoped>
.character-card {
  padding: 12px;
  border-bottom: 1px solid #e5e7eb;
  flex-shrink: 0;
}

.card-loading {
  font-size: 12px;
  color: #9ca3af;
  padding: 4px 0;
}

.card-body {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  margin-bottom: 8px;
}

.card-avatar {
  flex-shrink: 0;
  width: 36px;
  height: 36px;
  border-radius: 8px;
  background: #e0e7ff;
  color: #4338ca;
  font-size: 13px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
}

.card-info {
  min-width: 0;
  flex: 1;
}

.card-name {
  font-size: 13px;
  font-weight: 600;
  color: #111827;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.card-desc {
  font-size: 11px;
  color: #6b7280;
  margin-top: 2px;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.card-actions {
  display: flex;
  gap: 6px;
}

.card-btn {
  flex: 1;
  padding: 4px 8px;
  font-size: 12px;
  font-family: inherit;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  background: #fff;
  cursor: pointer;
  color: #374151;
}

.card-btn:hover {
  background: #f3f4f6;
}

.card-empty {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.card-empty-text {
  font-size: 12px;
  color: #9ca3af;
}
</style>
