<script setup lang="ts">
import { ref, watch } from 'vue'
import PopupWindow from '../../shared/ui/PopupWindow.vue'
import Button from '../../shared/ui/Button.vue'
import TextInput from '../../shared/ui/TextInput.vue'
import { useCharacterViewModel } from './useCharacterViewModel'

const props = defineProps<{ mode: 'create' | 'edit' }>()
const model = defineModel<boolean>({ required: true })
const emit = defineEmits<{ saved: [] }>()

const { activeCharacter, editDraft, isSavingCharacter, create, save } = useCharacterViewModel()

// Local draft for create mode
const newName = ref('')
const newDescription = ref('')
const newPersonaPrompt = ref('')
const newGreetingMessage = ref('')

// Reset create form when popup opens in create mode
watch(() => model.value, (open) => {
    if (open && props.mode === 'create') {
        newName.value = ''
        newDescription.value = ''
        newPersonaPrompt.value = ''
        newGreetingMessage.value = ''
    }
})

async function onSave() {
    if (props.mode === 'create') {
        const result = await create(newName.value, newDescription.value, newPersonaPrompt.value, newGreetingMessage.value)
        if (result) emit('saved')
    } else {
        await save()
        emit('saved')
    }
}

const title = props.mode === 'create' ? 'New Character' : 'Edit Character'
</script>

<template>
  <PopupWindow v-model="model" :title="title" :modal="true" width="480px">
    <div class="edit-form">

      <!-- Create mode fields -->
      <template v-if="mode === 'create'">
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
      </template>

      <!-- Edit mode fields (bound to shared editDraft) -->
      <template v-else-if="activeCharacter">
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
          <textarea v-model="editDraft.personaPrompt" class="textarea" rows="5"
            placeholder="Describe personality and speech style…" :disabled="isSavingCharacter" />
        </div>
        <div class="form-group">
          <label>Greeting Message</label>
          <TextInput v-model="editDraft.greetingMessage" placeholder="Opening line for new chats"
            :disabled="isSavingCharacter" />
        </div>
      </template>

    </div>

    <template #footer>
      <Button @click="model = false" :disabled="isSavingCharacter">Cancel</Button>
      <Button
        :disabled="isSavingCharacter || (mode === 'create' ? !newName.trim() : !editDraft.name.trim())"
        @click="onSave"
      >
        {{ isSavingCharacter ? 'Saving…' : (mode === 'create' ? 'Create' : 'Save') }}
      </Button>
    </template>
  </PopupWindow>
</template>

<style scoped>
.edit-form {
  display: flex;
  flex-direction: column;
  gap: 0;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 5px;
  margin-bottom: 12px;
}

.form-group label {
  font-size: 12px;
  color: #4b5563;
  font-weight: 500;
}

.required {
  color: #dc2626;
}

.textarea {
  border: 1px solid #d1d5db;
  border-radius: 8px;
  padding: 8px;
  font-size: 13px;
  font-family: inherit;
  resize: vertical;
  min-height: 64px;
}

.textarea:focus {
  outline: none;
  border-color: #6b7280;
}
</style>
