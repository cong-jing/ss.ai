<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import Button from "../../shared/ui/Button.vue";
import Panel from "../../shared/ui/Panel.vue";
import TextInput from "../../shared/ui/TextInput.vue";
import CollapsibleSection from "../../shared/ui/CollapsibleSection.vue";
import { useUserPreferenceViewModel } from "./useUserPreferenceViewModel";
import { useUserProfileViewModel } from "../userProfile/useUserProfileViewModel";
import type { ApiKeySource, ModelAssignmentSource, ModelCallPurpose } from "@ss-ai/contracts";
import { MODEL_CALL_PURPOSE_CATEGORIES } from "@ss-ai/contracts";
import { isSupportedLocale, locale, setLocale, t } from "../../shared/i18n/i18n";
import { SUPPORTED_LOCALES, type Locale } from "../../shared/i18n/messages";
import { useAuthState } from "../../auth/useAuthState";
import { localizeApiError } from "../../shared/api/localizeApiError";
import { useToast } from "../../shared/ui/useToast";

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

function modelsForProvider(providerName: string, purpose: ModelCallPurpose): string[] {
  const provider = providers.value.find(p => p.provider === providerName);
  if (!provider) return [];
  const category = MODEL_CALL_PURPOSE_CATEGORIES[purpose];
  return provider.availableModels[category] ?? [];
}

function effectiveApiKeySourceFor(providerName: string): ApiKeySource {
  return providers.value.find(p => p.provider === providerName)?.effectiveApiKeySource ?? "missing";
}

function apiKeyStatusLabel(source: ApiKeySource): string {
  switch (source) {
    case "user":
      return t("settings.apiKeySourceUser");
    case "default":
      return t("settings.apiKeySourceDefault");
    default:
      return t("settings.apiKeySourceMissing");
  }
}

function assignmentSourceLabel(source: ModelAssignmentSource): string {
  switch (source) {
    case "user":
      return t("settings.assignmentSourceUser");
    case "default":
      return t("settings.assignmentSourceDefault");
    default:
      return t("settings.assignmentSourceMissing");
  }
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
  switch (value) {
    case "zh-CN":
      return t("settings.language.zh-CN");
    case "ja-JP":
      return t("settings.language.ja-JP");
    case "en-US":
    default:
      return t("settings.language.en-US");
  }
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
  // Only fall back to live /v1/models when both static lists are empty;
  // a partial static config (e.g. chat populated, embed empty) is a
  // deliberate choice and live probing cannot reliably classify embed.
  if (
    p
    && p.availableModels.chat.length === 0
    && p.availableModels.embed.length === 0
    && p.effectiveApiKeySource !== "missing"
  ) {
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

const { authMode, logout } = useAuthState();
const toast = useToast();
const isLoggingOut = ref(false);
const showLogout = computed(() => authMode.value === "local-password");

async function onLogout(): Promise<void> {
  if (isLoggingOut.value) return;
  isLoggingOut.value = true;
  try {
    await logout();
  } catch (error) {
    toast.error(localizeApiError(error));
  } finally {
    isLoggingOut.value = false;
  }
}
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

      <CollapsibleSection :title="t('settings.section.apiKeys')">
        <div v-for="p in providers" :key="p.provider" class="provider-block">
          <div class="provider-header">
            <span class="provider-name">{{ p.provider }}</span>
            <span class="provider-source" :class="`provider-source--${p.effectiveApiKeySource}`">
              {{ apiKeyStatusLabel(p.effectiveApiKeySource) }}
            </span>
            <span v-if="p.testResult === 'ok'" class="badge badge--ok">OK</span>
            <span v-else-if="p.testResult === 'fail'" class="badge badge--fail">Failed</span>
          </div>

          <p v-if="p.effectiveApiKeySource === 'default'" class="default-key-warning">
            {{ t("settings.defaultApiKeyWarning") }}
          </p>

          <template v-if="p.userApiKeySet && p.apiKeyInput === null">
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
                <Button v-if="p.userApiKeySet" size="sm" @click="cancelEditApiKey(p.provider)">{{ t("common.cancel") }}</Button>
                <Button v-if="!p.userApiKeySet" size="sm" :disabled="p.isTestingKey || p.effectiveApiKeySource === 'missing'" @click="testApiKey(p.provider)">
                  {{ p.isTestingKey ? t("settings.testing") : t("common.test") }}
                </Button>
              </div>
            </div>
            <p v-if="p.testMessage" class="test-message" :class="p.testResult === 'ok' ? 'test-ok' : 'test-fail'">{{ p.testMessage }}</p>
          </template>
        </div>
      </CollapsibleSection>

      <CollapsibleSection :title="t('settings.section.modelAssignment')">
        <template v-for="(assignmentState, idx) in modelAssignments" :key="assignmentState.purpose">
          <!--
            Embed-category purposes (e.g. memory.embed) are not yet exposed in
            the UI — they are still configurable via server config but the
            user-facing model picker for embeddings will land in a later step.
          -->
          <div
            v-if="MODEL_CALL_PURPOSE_CATEGORIES[assignmentState.purpose] === 'chat'"
            class="fn-block"
          >
          <div class="fn-label">{{ formatModelCallPurpose(assignmentState.purpose) }}</div>
          <p class="assignment-source">{{ assignmentSourceLabel(assignmentState.effectiveSource) }}</p>
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
              <p v-if="effectiveApiKeySourceFor(assignmentState.provider) === 'missing'" class="hint-inline">{{ t("settings.apiKeyMissingForProvider") }}</p>
              <template v-else>
                <select
                  :value="assignmentState.model"
                  class="fn-select"
                  :disabled="modelsForProvider(assignmentState.provider, assignmentState.purpose).length === 0 || isSavingModelAssignment"
                  @change="onAssignmentModelChange(idx, assignmentState.purpose, ($event.target as HTMLSelectElement).value)"
                >
                  <option value="">
                    {{ modelsForProvider(assignmentState.provider, assignmentState.purpose).length === 0 ? t("settings.noModels") : t("settings.selectModel") }}
                  </option>
                  <option v-for="m in modelsForProvider(assignmentState.provider, assignmentState.purpose)" :key="m" :value="m">{{ m }}</option>
                </select>
                <Button
                  v-if="modelsForProvider(assignmentState.provider, assignmentState.purpose).length === 0"
                  size="sm"
                  @click="loadModels(assignmentState.provider)"
                >{{ t("settings.loadModels") }}</Button>
              </template>
            </template>
          </div>
          </div>
        </template>
      </CollapsibleSection>

      <div v-if="showLogout" class="settings-footer">
        <Button variant="danger" :disabled="isLoggingOut" @click="onLogout">
          {{ isLoggingOut ? t("auth.signingOut") : t("auth.logout") }}
        </Button>
      </div>
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

.settings-footer {
  display: flex;
  justify-content: flex-end;
  padding-top: 4px;
}

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
  flex-wrap: wrap;
}

.provider-name {
  font-size: 13px;
  font-weight: 600;
  color: #374151;
}

.provider-source {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 999px;
  border: 1px solid transparent;
}

.provider-source--user {
  background: #eef2ff;
  border-color: #c7d2fe;
  color: #4338ca;
}

.provider-source--default {
  background: #fffbeb;
  border-color: #fcd34d;
  color: #92400e;
}

.provider-source--missing {
  background: #f3f4f6;
  border-color: #d1d5db;
  color: #4b5563;
}

.default-key-warning {
  margin: 0 0 8px;
  padding: 8px 10px;
  border-radius: 8px;
  background: #fff7ed;
  border: 1px solid #fdba74;
  color: #9a3412;
  font-size: 12px;
  line-height: 1.5;
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
  flex-wrap: wrap;
}

.key-input-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.key-input {
  width: 100%;
}

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
  margin-bottom: 4px;
}

.assignment-source {
  font-size: 11px;
  color: #6b7280;
  margin: 0 0 6px;
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
