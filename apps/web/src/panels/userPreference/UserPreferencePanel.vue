<script setup lang="ts">
import { onMounted } from "vue";
import Button from "../../shared/ui/Button.vue";
import Panel from "../../shared/ui/Panel.vue";
import TextInput from "../../shared/ui/TextInput.vue";
import CollapsibleSection from "../../shared/ui/CollapsibleSection.vue";
import { useUserPreferenceViewModel } from "./useUserPreferenceViewModel";
import { AI_FUNCTION_LABELS, type AiFunction } from "@ss-ai/contracts";

const vm = useUserPreferenceViewModel();
const {
  providers,
  functionModels,
  isLoading,
  loadError,
  isSavingFunctionModel,
  loadSettings,
  startEditApiKey,
  cancelEditApiKey,
  saveApiKey,
  deleteApiKey,
  testApiKey,
  loadModels,
  saveFunctionModel
} = vm;

function modelsForProvider(providerName: string): string[] {
  return providers.value.find(p => p.provider === providerName)?.availableModels ?? [];
}

function apiKeySetFor(providerName: string): boolean {
  return providers.value.find(p => p.provider === providerName)?.apiKeySet ?? false;
}

async function onFnProviderChange(fn: AiFunction, idx: number, providerName: string) {
  functionModels.value[idx].provider = providerName;
  functionModels.value[idx].model = "";
  const p = providers.value.find(p => p.provider === providerName);
  if (p && p.availableModels.length === 0 && p.apiKeySet) {
    await loadModels(providerName);
  }
}

async function onFnModelChange(idx: number, fn: AiFunction, model: string) {
  functionModels.value[idx].model = model;
  const state = functionModels.value[idx];
  if (state.provider && state.model) {
    await saveFunctionModel(fn, state.provider, state.model);
  }
}

onMounted(() => {
  void loadSettings();
});
</script>

<template>
  <Panel title="Settings" class="user-settings-panel" :height-mode="'auto'">
    <div class="settings-content">
      <p v-if="isLoading" class="hint">Loading...</p>
      <p v-if="loadError" class="error">{{ loadError }}</p>

      <!-- Section 1: API Keys -->
      <CollapsibleSection title="API Keys">
        <div v-for="p in providers" :key="p.provider" class="provider-block">
          <div class="provider-header">
            <span class="provider-name">{{ p.provider }}</span>
            <span v-if="p.testResult === 'ok'" class="badge badge--ok">✓ OK</span>
            <span v-else-if="p.testResult === 'fail'" class="badge badge--fail">✗ Failed</span>
          </div>

          <!-- API key already set and not editing -->
          <template v-if="p.apiKeySet && p.apiKeyInput === null">
            <div class="key-row">
              <span class="key-set-hint">API key is set</span>
              <div class="key-actions">
                <Button size="sm" @click="startEditApiKey(p.provider)">Re-enter</Button>
                <Button size="sm" variant="danger" :disabled="p.isSavingKey" @click="deleteApiKey(p.provider)">Clear</Button>
                <Button size="sm" :disabled="p.isTestingKey" @click="testApiKey(p.provider)">
                  {{ p.isTestingKey ? 'Testing...' : 'Test' }}
                </Button>
              </div>
            </div>
            <p v-if="p.testMessage" class="test-message" :class="p.testResult === 'ok' ? 'test-ok' : 'test-fail'">{{ p.testMessage }}</p>
          </template>

          <!-- Editing or not set -->
          <template v-else>
            <div class="key-input-row">
              <TextInput
                v-model="p.apiKeyInput!"
                type="text"
                placeholder="Enter API Key"
                autocomplete="off"
                class="key-input key-input--masked"
              />
              <div class="key-actions">
                <Button size="sm" :disabled="p.isSavingKey || !p.apiKeyInput?.trim()" @click="saveApiKey(p.provider)">
                  {{ p.isSavingKey ? 'Saving...' : 'Save' }}
                </Button>
                <Button v-if="p.apiKeySet" size="sm" @click="cancelEditApiKey(p.provider)">Cancel</Button>
              </div>
            </div>
          </template>
        </div>
      </CollapsibleSection>

      <!-- Section 2: Model assignment per function -->
      <CollapsibleSection title="Model Assignment">
        <div v-for="(fnState, idx) in functionModels" :key="fnState.fn" class="fn-block">
          <div class="fn-label">{{ AI_FUNCTION_LABELS[fnState.fn] }}</div>
          <div class="fn-edit">
            <select
              :value="fnState.provider"
              class="fn-select"
              @change="onFnProviderChange(fnState.fn, idx, ($event.target as HTMLSelectElement).value)"
            >
              <option value="">Select provider</option>
              <option v-for="p in providers" :key="p.provider" :value="p.provider">{{ p.provider }}</option>
            </select>

            <template v-if="fnState.provider">
              <p v-if="!apiKeySetFor(fnState.provider)" class="hint-inline">API key not set for this provider</p>
              <template v-else>
                <select
                  :value="fnState.model"
                  class="fn-select"
                  :disabled="modelsForProvider(fnState.provider).length === 0 || isSavingFunctionModel"
                  @change="onFnModelChange(idx, fnState.fn, ($event.target as HTMLSelectElement).value)"
                >
                  <option value="">
                    {{ modelsForProvider(fnState.provider).length === 0 ? 'No models (load first)' : 'Select model' }}
                  </option>
                  <option v-for="m in modelsForProvider(fnState.provider)" :key="m" :value="m">{{ m }}</option>
                </select>
                <Button
                  v-if="modelsForProvider(fnState.provider).length === 0"
                  size="sm"
                  @click="loadModels(fnState.provider)"
                >Load models</Button>
              </template>
            </template>
          </div>
        </div>
      </CollapsibleSection>
    </div>
  </Panel>
</template>

<style scoped>
.user-settings-panel {
  height: 100%;
}

.settings-content {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

/* Provider blocks */
.provider-block {
  padding: 8px 0;
  border-bottom: 1px solid #f3f4f6;
}
.provider-block:last-child {
  border-bottom: none;
  padding-bottom: 0;
}

.provider-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}

.provider-name {
  font-size: 13px;
  font-weight: 600;
  color: #374151;
}

.badge {
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 999px;
}
.badge--ok { background: #d1fae5; color: #065f46; }
.badge--fail { background: #fee2e2; color: #b91c1c; }

.key-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.key-set-hint {
  font-size: 12px;
  color: #6b7280;
}

.key-actions {
  display: flex;
  gap: 4px;
}

.key-input-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.key-input {
  width: 100%;
}

/* Use CSS masking instead of type=password to avoid browser save-password prompts */
.key-input--masked :deep(input) {
  -webkit-text-security: disc;
  font-family: monospace;
}

.test-message {
  font-size: 11px;
  margin-top: 4px;
}
.test-ok { color: #065f46; }
.test-fail { color: #b91c1c; }

/* Function model blocks */
.fn-block {
  padding: 8px 0;
  border-bottom: 1px solid #f3f4f6;
}
.fn-block:last-child {
  border-bottom: none;
  padding-bottom: 0;
}

.fn-label {
  font-size: 12px;
  font-weight: 600;
  color: #4b5563;
  margin-bottom: 6px;
}

.fn-edit {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.fn-select {
  width: 100%;
  min-height: 32px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  padding: 4px 8px;
  font-size: 13px;
  font-family: inherit;
}

.hint-inline {
  font-size: 11px;
  color: #6b7280;
  margin: 0;
}

.hint {
  font-size: 12px;
  color: #6b7280;
  margin: 0;
}

.error {
  font-size: 12px;
  color: #b91c1c;
  margin: 0;
}
</style>

