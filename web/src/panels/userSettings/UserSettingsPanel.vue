<script setup lang="ts">
import { onMounted } from "vue";
import Button from "../../shared/ui/Button.vue";
import Panel from "../../shared/ui/Panel.vue";
import TextInput from "../../shared/ui/TextInput.vue";
import { useUserSettingsViewModel } from "./useUserSettingsViewModel";

const vm = useUserSettingsViewModel();
const { settings, isLoading, isSaving, error, canSave, loadSettings, saveSettings } = vm;

onMounted(() => {
  void loadSettings();
});
</script>

<template>
  <Panel title="User Settings" class="user-settings-panel">
    <div class="form-group">
      <label>Provider</label>
      <select v-model="settings.currentProvider" :disabled="isLoading || isSaving">
        <option v-for="provider in settings.providers" :key="provider" :value="provider">
          {{ provider }}
        </option>
      </select>
    </div>

    <div class="form-group">
      <label>API Key</label>
      <TextInput v-model="settings.apiKey" type="password" 
        :placeholder="settings.apiKeySet ? 'Already set (leave blank to keep current)' : 'Enter API Key'" />
    </div>

    <div class="form-group">
      <label>Model</label>
      <select v-model="settings.currentModel" :disabled="isSaving"
        @click="settings.availableModels.length === 0 ? loadSettings() : undefined"
        @change="settings.availableModels.length > 0 ? saveSettings() : undefined">
        <option v-if="settings.availableModels.length === 0" :value="null">No available models (click to load)</option>
        <option v-for="model in settings.availableModels" :key="model" :value="model">
          {{ model }}
        </option>
      </select>
    </div>

    <div class="actions">
      <Button :disabled="!canSave || isSaving" @click="saveSettings">{{ isSaving ? 'Saving...' : 'Save' }}</Button>
    </div>

    <p v-if="error" class="error">{{ error }}</p>
    <p v-else-if="isLoading" class="hint">Loading...</p>
    <p v-else class="hint">Settings loaded</p>
  </Panel>
</template>

<style scoped>
.user-settings-panel {
  height: 100%;
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

.form-group select {
  min-height: 36px;
  border: 1px solid #d1d5db;
  border-radius: 8px;
  padding: 6px 8px;
}

.actions {
  display: flex;
  align-items: center;
  gap: 12px;
}

.error {
  color: #b91c1c;
  font-size: 12px;
  margin-top: 12px;
}

.hint {
  color: #6b7280;
  font-size: 12px;
  margin-top: 12px;
}
</style>
