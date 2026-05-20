<script setup lang="ts">
import { onMounted } from "vue";
import Button from "../../shared/ui/Button.vue";
import Panel from "../../shared/ui/Panel.vue";
import TextInput from "../../shared/ui/TextInput.vue";
import CollapsibleSection from "../../shared/ui/CollapsibleSection.vue";
import { useUserPreferenceViewModel } from "./useUserPreferenceViewModel";
import { useUserProfileViewModel } from "../userProfile/useUserProfileViewModel";
import type { ModelCallPurpose } from "@ss-ai/contracts";
import { isSupportedLocale, locale, setLocale, t } from "../../shared/i18n/i18n";
import { SUPPORTED_LOCALES, type Locale } from "../../shared/i18n/messages";

const vm = useUserPreferenceViewModel();
const {
  providers,
  modelAssignments,
  isLoading,
  isSavingModelAssignment,
  loadSettings,
  startEditApiKey,
  cancelEditApiKey,
  saveApiKey,
  deleteApiKey,
  testApiKey,
  loadModels,
  saveModelAssignment
} = vm;

function modelsForProvider(providerName: string): string[] {
  return providers.value.find(p => p.provider === providerName)?.availableModels ?? [];
}

function apiKeySetFor(providerName: string): boolean {
  return providers.value.find(p => p.provider === providerName)?.apiKeySet ?? false;
}

function formatModelCallPurpose(purpose: ModelCallPurpose): string {
  switch (purpose) {
    case "chat.main":
      return "chat.main";
    case "memory.summarize":
      return "memory.summarize";
    default:
      return purpose;
  }
}

function localeLabel(value: Locale): string {
  return value === "zh-CN" ? t("settings.language.zh-CN") : t("settings.language.en-US");
}

function onLocaleChange(rawValue: string): void {
  if (isSupportedLocale(rawValue)) {
    setLocale(rawValue);
  }
}

async function onAssignmentProviderChange(_purpose: ModelCallPurpose, idx: number, providerName: string) {
  modelAssignments.value[idx].provider = providerName;
  modelAssignments.value[idx].model = "";
  const p = providers.value.find(p => p.provider === providerName);
  if (p && p.availableModels.length === 0 && p.apiKeySet) {
    await loadModels(providerName);
  }
}

async function onAssignmentModelChange(idx: number, purpose: ModelCallPurpose, model: string) {
  modelAssignments.value[idx].model = model;
  const state = modelAssignments.value[idx];
  if (state.provider && state.model) {
    await saveModelAssignment(purpose, state.provider, state.model);
  }
}

onMounted(() => {
  void loadSettings();
});

const userVm = useUserProfileViewModel();
const { userInfo, isLoadingUser, isSavingUser, loadUserInfo, saveUserInfo } = userVm;
onMounted(() => {
  void loadUserInfo();
});
</script>

<template>
  <Panel :title="t('settings.title')" class="user-settings-panel" :height-mode="'auto'">
    <div class="settings-content">
      <p v-if="isLoading" class="hint">{{ t('common.loading') }}</p>

      <CollapsibleSection :title="t('settings.language')">
        <div class="section-body">
          <div class="form-group">
            <label>{{ t("settings.language") }}</label>
            <select
              class="fn-select"
              :value="locale"
              @change="onLocaleChange(($event.target as HTMLSelectElement).value)"
            >
              <option v-for="value in SUPPORTED_LOCALES" :key="value" :value="value">
                {{ localeLabel(value) }}
              </option>
            </select>
          </div>
        </div>
      </CollapsibleSection>

      <!-- Section 0: User Info -->
      <CollapsibleSection :title="t('settings.section.userInfo')">
        <div class="section-body">
          <div class="form-group">
            <label>{{ t("settings.name") }}</label>
            <TextInput v-model="userInfo.name" :disabled="isLoadingUser || isSavingUser" :placeholder="t('settings.placeholder.name')" />
          </div>
          <div class="form-group">
            <label>{{ t("settings.profile") }}</label>
            <textarea v-model="userInfo.bio" :disabled="isLoadingUser || isSavingUser" :placeholder="t('settings.placeholder.profile')" rows="3" class="info-textarea" />
          </div>
          <div class="form-actions">
            <Button :disabled="isSavingUser || isLoadingUser" @click="saveUserInfo()">
              {{ isSavingUser ? t("common.saving") : t("common.save") }}
            </Button>
          </div>
        </div>
      </CollapsibleSection>

      <!-- Section 1: API Keys -->
      <CollapsibleSection :title="t('settings.section.apiKeys')">
        <div v-for="p in providers" :key="p.provider" class="provider-block">
          <div class="provider-header">
            <span class="provider-name">{{ p.provider }}</span>
            <span v-if="p.testResult === 'ok'" class="badge badge--ok">✓ OK</span>
            <span v-else-if="p.testResult === 'fail'" class="badge badge--fail">✗ Failed</span>
          </div>

          <!-- API key already set and not editing -->
          <template v-if="p.apiKeySet && p.apiKeyInput === null">
            <div class="key-row">
              <span class="key-set-hint">{{ t("settings.apiKeySet") }}</span>
              <div class="key-actions">
                <Button size="sm" @click="startEditApiKey(p.provider)">{{ t("settings.reenter") }}</Button>
                <Button size="sm" variant="danger" :disabled="p.isSavingKey" @click="deleteApiKey(p.provider)">{{ t("settings.clearKey") }}</Button>
                <Button size="sm" :disabled="p.isTestingKey" @click="testApiKey(p.provider)">
                  {{ p.isTestingKey ? t("settings.testing") : t("common.test") }}
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
                :placeholder="t('settings.enterApiKey')"
                autocomplete="off"
                class="key-input key-input--masked"
              />
              <div class="key-actions">
                <Button size="sm" :disabled="p.isSavingKey || !p.apiKeyInput?.trim()" @click="saveApiKey(p.provider)">
                  {{ p.isSavingKey ? t("common.saving") : t("common.save") }}
                </Button>
                <Button v-if="p.apiKeySet" size="sm" @click="cancelEditApiKey(p.provider)">{{ t("common.cancel") }}</Button>
              </div>
            </div>
          </template>
        </div>
      </CollapsibleSection>

      <!-- Section 2: Model assignment per purpose -->
      <CollapsibleSection :title="t('settings.section.modelAssignment')">
        <div v-for="(assignmentState, idx) in modelAssignments" :key="assignmentState.purpose" class="fn-block">
          <div class="fn-label">{{ formatModelCallPurpose(assignmentState.purpose) }}</div>
          <div class="fn-edit">
            <select
              :value="assignmentState.provider"
              class="fn-select"
              @change="onAssignmentProviderChange(assignmentState.purpose, idx, ($event.target as HTMLSelectElement).value)"
            >
              <option value="">{{ t("settings.selectProvider") }}</option>
              <option v-for="p in providers" :key="p.provider" :value="p.provider">{{ p.provider }}</option>
            </select>

            <template v-if="assignmentState.provider">
              <p v-if="!apiKeySetFor(assignmentState.provider)" class="hint-inline">{{ t("settings.apiKeyMissingForProvider") }}</p>
              <template v-else>
                <select
                  :value="assignmentState.model"
                  class="fn-select"
                  :disabled="modelsForProvider(assignmentState.provider).length === 0 || isSavingModelAssignment"
                  @change="onAssignmentModelChange(idx, assignmentState.purpose, ($event.target as HTMLSelectElement).value)"
                >
                  <option value="">
                    {{ modelsForProvider(assignmentState.provider).length === 0 ? t("settings.noModels") : t("settings.selectModel") }}
                  </option>
                  <option v-for="m in modelsForProvider(assignmentState.provider)" :key="m" :value="m">{{ m }}</option>
                </select>
                <Button
                  v-if="modelsForProvider(assignmentState.provider).length === 0"
                  size="sm"
                  @click="loadModels(assignmentState.provider)"
                >{{ t("settings.loadModels") }}</Button>
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

/* User info section */
.section-body {
  padding: 4px 0 8px;
}
.form-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 10px;
}
.form-group label {
  font-size: 11px;
  font-weight: 500;
  color: #6b7280;
}
.info-textarea {
  border: 1px solid #d1d5db;
  border-radius: 6px;
  padding: 6px 8px;
  font-size: 13px;
  font-family: inherit;
  resize: vertical;
  line-height: 1.5;
}
.info-textarea:focus {
  outline: none;
  border-color: #6b7280;
}
.form-actions {
  display: flex;
  justify-content: flex-end;
}

.error {
  font-size: 12px;
  color: #b91c1c;
  margin: 0;
}
</style>

