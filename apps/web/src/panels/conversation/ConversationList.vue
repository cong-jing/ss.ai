<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import ConversationItem from './ConversationItem.vue'
import { useConversationViewModel } from './useConversationViewModel'
import CharacterPickerPopup from '../character/CharacterPickerPopup.vue'
import {
  activeCharacterId,
  activeCharacter,
  useCharacterViewModel,
} from '../character/useCharacterViewModel'
import {
  actors,
  selectedActorId,
  expandedActorIds,
  isLoadingActors,
  isSavingActor,
  useActorViewModel,
} from './useActorViewModel'

const {
    conversations, activeConversationId, isLoadingConversations,
    load, createConversation, selectConversation, deleteConversation,
} = useConversationViewModel()
const { create: createCharacter, select: selectCharacter } = useCharacterViewModel()
const {
  load: loadActors,
  select: selectActor,
  toggleExpand,
  createActor,
  updateActor,
  deleteActor,
} = useActorViewModel()

const showPicker = ref(false)
const newActorName = ref('')
const editingActorId = ref<string | null>(null)
const editingName = ref('')
const editingProfileSnapshot = ref('')

onMounted(() => {
    if (activeCharacterId.value) {
      void load()
      void loadActors()
    }
})

// Reload when character changes
watch(activeCharacterId, (id) => {
    if (!id) {
      conversations.value = []
      activeConversationId.value = null
      void loadActors()
      return
    }
    void load().then(() => loadActors())
})

watch(activeConversationId, () => {
  void loadActors()
})

async function onSelectConversation(id: string) {
  await selectConversation(id)
  await loadActors()
}

async function onCreateConversation() {
  await createConversation()
  await loadActors()
}

async function onDeleteConversation(id: string) {
  await deleteConversation(id)
  await loadActors()
}

async function onNewCharacter() {
  const created = await createCharacter('New Character', '', '', '')
  showPicker.value = false
  if (created) {
    await selectCharacter(created.id)
    await load()
    await loadActors()
  }
}

async function onCreateActor() {
  await createActor(newActorName.value)
  newActorName.value = ''
}

function startEdit(actorId: string, name: string, profileSnapshotJson: string | null) {
  editingActorId.value = actorId
  editingName.value = name
  editingProfileSnapshot.value = profileSnapshotJson ?? ''
}

function cancelEdit() {
  editingActorId.value = null
  editingName.value = ''
  editingProfileSnapshot.value = ''
}

async function submitEdit(actorId: string) {
  const name = editingName.value.trim()
  if (!name) return
  await updateActor({
    actorId,
    displayName: name,
    profileSnapshotJson: editingProfileSnapshot.value.trim() || null,
  })
  cancelEdit()
}
</script>

<template>
  <div class="conv-list">
    <div class="section-header">
      <span class="section-title">Character</span>
      <button class="switch-btn" @click="showPicker = true">Switch</button>
    </div>
    <div class="section-body section-body--tight">
      <p v-if="activeCharacter" class="selected-character">{{ activeCharacter.name }}</p>
      <p v-else class="hint">No character selected.</p>
    </div>

    <div class="conv-list-header">
      <span class="conv-list-title">Conversations</span>
      <button
        class="new-btn"
        :disabled="isLoadingConversations || !activeCharacterId"
        @click="onCreateConversation"
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
        @select="onSelectConversation(conv.id)"
        @delete="onDeleteConversation(conv.id)"
      />
    </div>

    <div class="section-header">
      <span class="section-title">Actors</span>
    </div>
    <div class="section-body">
      <p v-if="!activeConversationId" class="hint">Select a conversation first.</p>
      <p v-else-if="isLoadingActors" class="hint">Loading actors…</p>
      <template v-else>
        <div class="actor-create">
          <input
            v-model="newActorName"
            class="actor-input"
            placeholder="New actor name"
            :disabled="isSavingActor"
            @keydown.enter.prevent="onCreateActor"
          />
          <button class="actor-add-btn" :disabled="isSavingActor || !newActorName.trim()" @click="onCreateActor">Add</button>
        </div>

        <p v-if="actors.length === 0" class="hint">No actors yet.</p>

        <div v-for="actor in actors" :key="actor.id" class="actor-item" :class="{ 'actor-item--selected': actor.id === selectedActorId }">
          <div class="actor-row">
            <button class="actor-select" @click="selectActor(actor.id)">
              <span class="actor-name">{{ actor.displayName }}</span>
              <span class="actor-type" :class="`actor-type--${actor.sourceType}`">{{ actor.sourceType }}</span>
            </button>
            <div class="actor-actions">
              <button class="actor-mini-btn" @click="toggleExpand(actor.id)">
                {{ expandedActorIds.includes(actor.id) ? '▾' : '▸' }}
              </button>
              <button
                v-if="actor.sourceType === 'local_actor'"
                class="actor-mini-btn"
                @click="startEdit(actor.id, actor.displayName, actor.profileSnapshotJson)"
              >Edit</button>
              <button
                v-if="actor.sourceType === 'local_actor'"
                class="actor-mini-btn danger"
                @click="deleteActor(actor.id)"
              >Del</button>
              <span v-else class="actor-lock">Read-only</span>
            </div>
          </div>
          <div v-if="expandedActorIds.includes(actor.id)" class="actor-expand">
            <template v-if="editingActorId === actor.id">
              <input
                v-model="editingName"
                class="actor-input"
                :disabled="isSavingActor"
                @keydown.enter.prevent="submitEdit(actor.id)"
              />
              <textarea
                v-model="editingProfileSnapshot"
                class="actor-textarea"
                rows="3"
                :disabled="isSavingActor"
                placeholder="Profile snapshot JSON (optional)"
              />
              <div class="actor-edit-actions">
                <button class="actor-mini-btn" :disabled="isSavingActor || !editingName.trim()" @click="submitEdit(actor.id)">Save</button>
                <button class="actor-mini-btn" :disabled="isSavingActor" @click="cancelEdit">Cancel</button>
              </div>
            </template>
            <template v-else>
              <p class="actor-meta">id: {{ actor.id }}</p>
              <p class="actor-meta">source: {{ actor.sourceType }}</p>
              <p v-if="actor.profileSnapshotJson" class="actor-meta">snapshot: {{ actor.profileSnapshotJson }}</p>
            </template>
          </div>
        </div>
      </template>
    </div>
  </div>

  <CharacterPickerPopup v-model="showPicker" @new-character="onNewCharacter" />
</template>

<style scoped>
.conv-list {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 12px 6px;
  border-bottom: 1px solid #e5e7eb;
}

.section-title {
  font-size: 12px;
  font-weight: 600;
  color: #6b7280;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.section-body {
  border-bottom: 1px solid #e5e7eb;
  padding: 8px 8px;
  overflow-y: auto;
  max-height: 34%;
}

.section-body--tight {
  max-height: none;
  overflow: hidden;
}

.selected-character {
  margin: 0;
  font-size: 13px;
  color: #111827;
}

.switch-btn {
  border: 1px solid #d1d5db;
  border-radius: 6px;
  background: #fff;
  color: #374151;
  font-size: 11px;
  padding: 3px 8px;
  cursor: pointer;
}

.switch-btn:hover {
  background: #f3f4f6;
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

.actor-create {
  display: flex;
  gap: 6px;
  margin-bottom: 6px;
}

.actor-input {
  flex: 1;
  min-width: 0;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  padding: 4px 6px;
  font-size: 12px;
}

.actor-textarea {
  margin-top: 6px;
  width: 100%;
  box-sizing: border-box;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  padding: 6px;
  font-size: 12px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}

.actor-add-btn {
  border: 1px solid #d1d5db;
  border-radius: 6px;
  background: #fff;
  font-size: 12px;
  padding: 4px 8px;
  cursor: pointer;
}

.actor-item {
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  margin-bottom: 6px;
  background: #fff;
}

.actor-item--selected {
  border-color: #93c5fd;
  background: #eff6ff;
}

.actor-row {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px;
}

.actor-select {
  flex: 1;
  border: none;
  background: none;
  text-align: left;
  cursor: pointer;
}

.actor-name {
  display: block;
  font-size: 12px;
  color: #111827;
}

.actor-type {
  display: block;
  font-size: 10px;
  color: #111827;
  width: fit-content;
  margin-top: 2px;
  border-radius: 999px;
  padding: 1px 6px;
  background: #e5e7eb;
}

.actor-type--local_actor {
  background: #dbeafe;
  color: #1d4ed8;
}

.actor-type--logged_user {
  background: #dcfce7;
  color: #166534;
}

.actor-type--ai_character {
  background: #ede9fe;
  color: #5b21b6;
}

.actor-type--system {
  background: #fee2e2;
  color: #991b1b;
}

.actor-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}

.actor-mini-btn {
  border: 1px solid #d1d5db;
  border-radius: 4px;
  background: #fff;
  font-size: 10px;
  padding: 2px 5px;
  cursor: pointer;
}

.actor-mini-btn.danger {
  color: #b91c1c;
}

.actor-lock {
  font-size: 10px;
  color: #6b7280;
}

.actor-expand {
  border-top: 1px solid #e5e7eb;
  padding: 6px;
}

.actor-meta {
  margin: 0;
  font-size: 10px;
  color: #6b7280;
}

.actor-edit-actions {
  margin-top: 6px;
  display: flex;
  gap: 4px;
}
</style>
