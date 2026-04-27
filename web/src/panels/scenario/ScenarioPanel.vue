<script setup lang="ts">
import { onMounted } from "vue";
import Button from "../../shared/ui/Button.vue";
import Panel from "../../shared/ui/Panel.vue";
import TextInput from "../../shared/ui/TextInput.vue";
import { useScenarioViewModel } from "./useScenarioViewModel";

const {
  userInfo,
  characterInfo,
  isLoadingUser,
  isSavingUser,
  userError,
  isLoadingCharacter,
  isSavingCharacter,
  characterError,
  loadUserInfo,
  saveUserInfo,
  loadCharacterInfo,
  saveCharacterInfo
} = useScenarioViewModel();

onMounted(() => {
  void loadUserInfo();
  void loadCharacterInfo();
});
</script>

<template>
  <div class="scenario-panel">
    <Panel title="User Info" class="info-section">
      <div class="form-group">
        <label>Name</label>
        <TextInput v-model="userInfo.name" :disabled="isLoadingUser || isSavingUser" placeholder="Enter your name" />
      </div>
      <div class="form-group">
        <label>Profile</label>
        <textarea v-model="userInfo.bio" :disabled="isLoadingUser || isSavingUser" placeholder="Enter your profile" rows="4" class="textarea" />
      </div>
      <div class="actions">
        <Button :disabled="isSavingUser || isLoadingUser" @click="saveUserInfo">
          {{ isSavingUser ? 'Saving...' : 'Save' }}
        </Button>
      </div>
      <p v-if="userError" class="error">{{ userError }}</p>
      <p v-else-if="isLoadingUser" class="hint">Loading...</p>
    </Panel>

    <Panel title="Character" class="info-section">
      <div class="form-group">
        <label>Character Name</label>
        <TextInput v-model="characterInfo.name" :disabled="isLoadingCharacter || isSavingCharacter" placeholder="Enter character name" />
      </div>
      <div class="form-group">
        <label>Character Description</label>
        <textarea v-model="characterInfo.description" :disabled="isLoadingCharacter || isSavingCharacter" placeholder="Describe the character" rows="4" class="textarea" />
      </div>
      <div class="actions">
        <Button :disabled="isSavingCharacter || isLoadingCharacter" @click="saveCharacterInfo">
          {{ isSavingCharacter ? 'Saving...' : 'Save' }}
        </Button>
      </div>
      <p v-if="characterError" class="error">{{ characterError }}</p>
      <p v-else-if="isLoadingCharacter" class="hint">Loading...</p>
    </Panel>
  </div>
</template>

<style scoped>
.scenario-panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
  height: 100%;
  overflow-y: auto;
  padding: 12px;
}

.info-section {
  flex-shrink: 0;
}

/* Override Panel's height: 100% so stacked panels use natural height */
.info-section :deep(.panel) {
  height: auto;
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

.textarea {
  border: 1px solid #d1d5db;
  border-radius: 8px;
  padding: 8px;
  font-size: 14px;
  font-family: inherit;
  resize: vertical;
  outline: none;
  transition: border-color 0.15s;
}

.textarea:focus {
  border-color: #6366f1;
}

.textarea:disabled {
  background: #f3f4f6;
  color: #9ca3af;
}

.actions {
  display: flex;
  align-items: center;
  gap: 12px;
}

.error {
  color: #b91c1c;
  font-size: 12px;
  margin-top: 8px;
}

.hint {
  color: #6b7280;
  font-size: 12px;
  margin-top: 8px;
}
</style>
