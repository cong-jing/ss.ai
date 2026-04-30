<script setup lang="ts">
import { onMounted } from "vue";
import Button from "../../shared/ui/Button.vue";
import CollapsibleSection from "../../shared/ui/CollapsibleSection.vue";
import TextInput from "../../shared/ui/TextInput.vue";
import { useScenarioViewModel } from "./useScenarioViewModel";

const {
  userInfo, isLoadingUser, isSavingUser, userError,
  loadUserInfo, saveUserInfo,
  characters, activeCharacterId, activeCharacter,
  editDraft,
  isLoadingCharacters, isSavingCharacter, characterError,
  isCreating, newName, newDescription,
  loadCharacters,
  selectCharacter,
  openCreateForm, cancelCreate, createCharacter,
  saveCharacter,
  deleteCharacter,
} = useScenarioViewModel();

onMounted(() => {
  void loadUserInfo();
  void loadCharacters();
});

function onSelectChange(e: Event) {
  const val = (e.target as HTMLSelectElement).value;
  if (val) void selectCharacter(val);
}
</script>

<template>
  <div class="scenario-panel">

    <!-- ── User Info ──────────────────────────────────────────────────────── -->
    <CollapsibleSection title="User Info">
      <div class="section-body">
        <div class="form-group">
          <label>Name</label>
          <TextInput v-model="userInfo.name" :disabled="isLoadingUser || isSavingUser" placeholder="Enter your name" />
        </div>
        <div class="form-group">
          <label>Profile</label>
          <textarea v-model="userInfo.bio" :disabled="isLoadingUser || isSavingUser"
            placeholder="Enter your profile" rows="3" class="textarea" />
        </div>
        <div class="actions">
          <Button :disabled="isSavingUser || isLoadingUser" @click="saveUserInfo">
            {{ isSavingUser ? 'Saving…' : 'Save' }}
          </Button>
        </div>
        <p v-if="userError" class="error">{{ userError }}</p>
        <p v-else-if="isLoadingUser" class="hint">Loading…</p>
      </div>
    </CollapsibleSection>

    <!-- ── Character ─────────────────────────────────────────────────────── -->
    <CollapsibleSection title="Character">
      <div class="section-body">

        <!-- Selector row -->
        <div class="select-row">
          <select
            class="character-select"
            :disabled="isLoadingCharacters || isSavingCharacter || characters.length === 0"
            :value="activeCharacterId ?? ''"
            @change="onSelectChange"
          >
            <option v-if="characters.length === 0" value="" disabled>— No characters —</option>
            <option v-for="c in characters" :key="c.id" :value="c.id">{{ c.name }}</option>
          </select>

          <Button size="sm" @click="openCreateForm" :disabled="isCreating || isSavingCharacter">
            + New
          </Button>
          <Button
            v-if="activeCharacter"
            size="sm"
            variant="danger"
            :disabled="isSavingCharacter"
            @click="deleteCharacter"
          >
            Delete
          </Button>
        </div>

        <!-- Inline create form -->
        <template v-if="isCreating">
          <div class="create-form">
            <div class="form-group">
              <label>Name <span class="required">*</span></label>
              <TextInput v-model="newName" placeholder="Character name" :disabled="isSavingCharacter" />
            </div>
            <div class="form-group">
              <label>Description</label>
              <textarea v-model="newDescription" placeholder="Character description" rows="3"
                class="textarea" :disabled="isSavingCharacter" />
            </div>
            <div class="actions">
              <Button :disabled="!newName.trim() || isSavingCharacter" @click="createCharacter">
                {{ isSavingCharacter ? 'Creating…' : 'Create' }}
              </Button>
              <Button @click="cancelCreate" :disabled="isSavingCharacter">Cancel</Button>
            </div>
          </div>
        </template>

        <!-- Edit active character -->
        <template v-else-if="activeCharacter">
          <div class="form-group">
            <label>Name</label>
            <TextInput v-model="editDraft.name" :disabled="isSavingCharacter" placeholder="Character name" />
          </div>
          <div class="form-group">
            <label>Description</label>
            <textarea v-model="editDraft.description" :disabled="isSavingCharacter"
              placeholder="Character description" rows="4" class="textarea" />
          </div>
          <div class="actions">
            <Button :disabled="isSavingCharacter" @click="saveCharacter">
              {{ isSavingCharacter ? 'Saving…' : 'Save' }}
            </Button>
          </div>
        </template>

        <p v-if="characterError" class="error">{{ characterError }}</p>
        <p v-else-if="isLoadingCharacters" class="hint">Loading…</p>
        <p v-else-if="!activeCharacter && !isCreating" class="hint">No character selected. Create one to get started.</p>
      </div>
    </CollapsibleSection>

  </div>
</template>

<style scoped>
.scenario-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
  height: 100%;
  overflow-y: auto;
  padding: 12px;
}

.section-body {
  padding: 12px;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 12px;
}

.form-group label {
  font-size: 12px;
  color: #4b5563;
}

.required {
  color: #dc2626;
}

.textarea {
  border: 1px solid #d1d5db;
  border-radius: 8px;
  padding: 8px;
  font-size: 14px;
  font-family: inherit;
  resize: vertical;
  min-height: 72px;
}

.textarea:focus {
  outline: none;
  border-color: #6b7280;
}

.select-row {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-bottom: 14px;
}

.character-select {
  flex: 1;
  min-height: 34px;
  border: 1px solid #d1d5db;
  border-radius: 8px;
  padding: 4px 8px;
  font-size: 13px;
  font-family: inherit;
  background: #fff;
  cursor: pointer;
}

.character-select:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.create-form {
  background: #f9fafb;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 12px;
  margin-bottom: 12px;
}

.actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.error {
  margin: 6px 0 0;
  font-size: 12px;
  color: #dc2626;
}

.hint {
  margin: 6px 0 0;
  font-size: 12px;
  color: #6b7280;
}
</style>
