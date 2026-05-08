<script setup lang="ts">
import { ref, onMounted } from 'vue'
import Button from '../../shared/ui/Button.vue'
import TextInput from '../../shared/ui/TextInput.vue'
import ModelSelector from '../../shared/ui/ModelSelector.vue'
import CharacterPickerPopup from './CharacterPickerPopup.vue'
import { useCharacterViewModel, characters, isDirty } from './useCharacterViewModel'
import { useUserPreferenceViewModel } from '../userPreference/useUserPreferenceViewModel'
import { AI_FUNCTIONS, AI_FUNCTION_LABELS } from '@ss-ai/contracts'

const {
    activeCharacter, isLoadingCharacters, isSavingCharacter,
    editDraft, create, save, remove,
} = useCharacterViewModel()

const { providers, loadSettings } = useUserPreferenceViewModel()

const showPicker = ref(false)

// Create-new form
const newName = ref('')
const newDescription = ref('')
const newPersonaPrompt = ref('')
const newGreetingMessage = ref('')

async function onCreateSave() {
    const result = await create(newName.value, newDescription.value, newPersonaPrompt.value, newGreetingMessage.value)
    if (result) {
        newName.value = ''
        newDescription.value = ''
        newPersonaPrompt.value = ''
        newGreetingMessage.value = ''
    }
}

function initials(name: string): string {
    return name.trim().slice(0, 2).toUpperCase()
}

onMounted(() => {
    void loadSettings()
})
</script>

<template>
  <div class="character-panel">
    <div v-if="isLoadingCharacters" class="hint">Loading…</div>

    <!-- ── Edit mode ─────────────────────────────────────────────────────── -->
    <template v-else-if="activeCharacter">
      <!-- Header row -->
      <div class="panel-header">
        <div class="char-avatar">{{ initials(activeCharacter.name) }}</div>
        <div class="char-title">{{ activeCharacter.name }}</div>
        <button class="switch-btn" @click="showPicker = true">Switch</button>
      </div>

      <!-- Fields -->
      <div class="form-group">
        <label>Name <span class="required">*</span></label>
        <TextInput v-model="editDraft.name" placeholder="Character name" :disabled="isSavingCharacter" />
      </div>
      <div class="form-group">
        <label>Description</label>
        <textarea v-model="editDraft.description" class="textarea" rows="2"
          placeholder="Short description" :disabled="isSavingCharacter" />
      </div>
      <div class="form-group">
        <label>Persona Prompt</label>
        <textarea v-model="editDraft.personaPrompt" class="textarea" rows="6"
          placeholder="Describe personality and speech style…" :disabled="isSavingCharacter" />
      </div>
      <div class="form-group">
        <label>Greeting Message</label>
        <TextInput v-model="editDraft.greetingMessage" placeholder="Opening line for new chats"
          :disabled="isSavingCharacter" />
      </div>

      <!-- ── Section divider ───────────────────────────────────────────── -->
      <div class="section-divider">
        <span class="section-divider-label">Model Overrides</span>
      </div>
      <p class="section-hint">Override the per-function model for this character. Unset = inherit from Settings.</p>

      <!-- Model Overrides -->
      <div v-for="fn in AI_FUNCTIONS" :key="fn" class="override-block">
        <label class="override-check-row">
          <input type="checkbox" v-model="editDraft.modelOverrides[fn].enabled" :disabled="isSavingCharacter" />
          <span class="override-fn-label">{{ AI_FUNCTION_LABELS[fn] }}</span>
        </label>
        <div v-if="editDraft.modelOverrides[fn].enabled" class="override-selector">
          <ModelSelector
            :provider="editDraft.modelOverrides[fn].provider"
            :model="editDraft.modelOverrides[fn].model"
            :providers="providers"
            :disabled="isSavingCharacter"
            @update:provider="editDraft.modelOverrides[fn].provider = $event; editDraft.modelOverrides[fn].model = ''"
            @update:model="editDraft.modelOverrides[fn].model = $event"
          />
        </div>
      </div>

      <!-- Actions -->
      <div class="actions">
        <Button
          :variant="isDirty && editDraft.name.trim() ? 'primary' : 'default'"
          :disabled="isSavingCharacter || !isDirty || !editDraft.name.trim()"
          @click="save"
        >{{ isSavingCharacter ? 'Saving…' : 'Save' }}</Button>
        <Button variant="danger" :disabled="isSavingCharacter" @click="remove">Delete</Button>
      </div>
    </template>

    <!-- ── Create mode ───────────────────────────────────────────────────── -->
    <template v-else>
      <p class="hint">No character yet.</p>
      <div class="form-group">
        <label>Name <span class="required">*</span></label>
        <TextInput v-model="newName" placeholder="Character name" :disabled="isSavingCharacter" />
      </div>
      <div class="form-group">
        <label>Description</label>
        <textarea v-model="newDescription" class="textarea" rows="2"
          placeholder="Short description" :disabled="isSavingCharacter" />
      </div>
      <div class="form-group">
        <label>Persona Prompt</label>
        <textarea v-model="newPersonaPrompt" class="textarea" rows="5"
          placeholder="Describe personality and speech style…" :disabled="isSavingCharacter" />
      </div>
      <div class="form-group">
        <label>Greeting Message</label>
        <TextInput v-model="newGreetingMessage" placeholder="Opening line for new chats"
          :disabled="isSavingCharacter" />
      </div>
      <div class="actions">
        <Button
          :disabled="isSavingCharacter || !newName.trim()"
          @click="onCreateSave"
        >{{ isSavingCharacter ? 'Creating…' : '+ Create' }}</Button>
        <button v-if="characters?.length" class="switch-btn" @click="showPicker = true">Switch</button>
      </div>
    </template>
  </div>

  <CharacterPickerPopup v-model="showPicker" @new-character="showPicker = false" />
</template>

<style scoped>
.character-panel {
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.hint {
  font-size: 12px;
  color: #9ca3af;
  margin: 0;
}

.panel-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-bottom: 10px;
  border-bottom: 1px solid #e5e7eb;
  margin-bottom: 2px;
}

.char-avatar {
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

.char-title {
  flex: 1;
  font-size: 13px;
  font-weight: 600;
  color: #111827;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.switch-btn {
  flex-shrink: 0;
  padding: 3px 8px;
  font-size: 11px;
  font-family: inherit;
  border: 1px solid #d1d5db;
  border-radius: 5px;
  background: #fff;
  cursor: pointer;
  color: #374151;
}

.switch-btn:hover {
  background: #f3f4f6;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.form-group label {
  font-size: 11px;
  font-weight: 500;
  color: #6b7280;
}

.required {
  color: #ef4444;
}

.textarea {
  border: 1px solid #d1d5db;
  border-radius: 6px;
  padding: 6px 8px;
  font-size: 13px;
  font-family: inherit;
  resize: vertical;
  line-height: 1.5;
}

.textarea:focus {
  outline: none;
  border-color: #6b7280;
}

.textarea:disabled {
  background: #f9fafb;
  color: #9ca3af;
}

.actions {
  display: flex;
  gap: 8px;
  padding-top: 4px;
}

/* Section divider */
.section-divider {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 4px;
}

.section-divider::before,
.section-divider::after {
  content: '';
  flex: 1;
  height: 1px;
  background: #e5e7eb;
}

.section-divider-label {
  font-size: 10px;
  font-weight: 600;
  color: #9ca3af;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  white-space: nowrap;
}

.section-hint {
  font-size: 11px;
  color: #9ca3af;
  margin: -4px 0 0;
  line-height: 1.4;
}

/* Model overrides */

.override-block {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.override-check-row {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
}

.override-fn-label {
  font-size: 12px;
  color: #374151;
}

.override-selector {
  padding-left: 20px;
}
</style>
