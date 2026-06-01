<script setup lang="ts">
import { INTERACTION_MODE_I18N_KEYS, type Character, type InteractionMode } from "@ss-ai/contracts";
import { useLocalStorage } from "../../../shared/ui/useLocalStorage";
import { t } from "../../../shared/i18n/i18n";

function interactionModeLabel(mode: InteractionMode): string {
  return t(INTERACTION_MODE_I18N_KEYS[mode]);
}

function languageLabel(language: "zh-CN" | "en-US" | "ja-JP"): string {
  return t(`settings.language.${language}` as const);
}

const props = defineProps<{
  isOpen: boolean;
  activeCharacter: Character | null;
  isEditing: boolean;
  interactionModes: InteractionMode[];
  editDraft: {
    name: string;
    displayName: string;
    description: string;
    personaPrompt: string;
    interactionMode: InteractionMode;
    language: "zh-CN" | "en-US" | "ja-JP";
  };
  isDirty: boolean;
  isSavingCharacter: boolean;
}>();

const emit = defineEmits<{
  "character:toggle-open": [];
  "character:open-picker": [];
  "character:create": [];
  "character:start-edit": [];
  "character:cancel-edit": [];
  "character:save": [];
  "character:remove": [];
}>();

const showDebug = useLocalStorage("chat.showDebug", false);
</script>

<template>
  <section class="group group--character">
    <button class="group-header" @click="emit('character:toggle-open')">
      <span>{{ t("sidebar.character") }}</span>
      <span>{{ isOpen ? "▾" : "▸" }}</span>
    </button>

    <div v-if="isOpen" class="group-body compact">
      <div class="row-inline row-inline--between">
        <button class="mini-btn" @click="emit('character:open-picker')">{{ t("sidebar.switch") }}</button>
        <template v-if="activeCharacter">
          <span class="current-name" :title="activeCharacter.name">{{ activeCharacter.name }}</span>
          <span v-if="showDebug" class="current-id" :title="activeCharacter.id">{{ activeCharacter.id }}</span>
        </template>
        <span v-else class="hint">{{ t("sidebar.noCharacterSelected") }}</span>
      </div>

      <template v-if="activeCharacter">
        <template v-if="isEditing">
          <label class="field-label">{{ t("sidebar.field.name") }}</label>
          <input v-model="props.editDraft.name" class="input" :disabled="isSavingCharacter" />

          <label class="field-label">{{ t("sidebar.field.displayName") }}</label>
          <input v-model="props.editDraft.displayName" class="input" :disabled="isSavingCharacter" :placeholder="t('sidebar.optional')" />

          <label class="field-label">{{ t("sidebar.field.description") }}</label>
          <textarea v-model="props.editDraft.description" class="textarea" rows="2" :disabled="isSavingCharacter" />

          <label class="field-label">{{ t("sidebar.field.persona") }}</label>
          <textarea v-model="props.editDraft.personaPrompt" class="textarea" rows="3" :disabled="isSavingCharacter" />

          <label class="field-label">{{ t("sidebar.field.language") }}</label>
          <select v-model="props.editDraft.language" class="select" :disabled="isSavingCharacter">
            <option value="zh-CN">{{ t("settings.language.zh-CN") }}</option>
            <option value="en-US">{{ t("settings.language.en-US") }}</option>
            <option value="ja-JP">{{ t("settings.language.ja-JP") }}</option>
          </select>

          <label class="field-label">{{ t("sidebar.field.interactionMode") }}</label>
          <select v-model="props.editDraft.interactionMode" class="select" :disabled="true">
            <option v-for="mode in interactionModes" :key="mode" :value="mode">
              {{ interactionModeLabel(mode) }}
            </option>
          </select>

          <div class="actions">
            <button
              class="mini-btn primary"
              :disabled="isSavingCharacter || !isDirty || !props.editDraft.name.trim()"
              @click="emit('character:save')"
            >
              {{ t("common.save") }}
            </button>
            <button class="mini-btn" :disabled="isSavingCharacter" @click="emit('character:cancel-edit')">{{ t("common.cancel") }}</button>
          </div>
        </template>

        <template v-else>
          <div class="read-row">
            <span class="field-label">{{ t("sidebar.field.name") }}</span>
            <p class="read-value">{{ activeCharacter.name }}</p>
          </div>
          <div class="read-row">
            <span class="field-label">{{ t("sidebar.field.displayName") }}</span>
            <p class="read-value">{{ activeCharacter.displayName || t("sidebar.notSet") }}</p>
          </div>
          <div class="read-row">
            <span class="field-label">{{ t("sidebar.field.description") }}</span>
            <p class="read-value multiline">{{ activeCharacter.description || t("sidebar.empty") }}</p>
          </div>
          <div class="read-row">
            <span class="field-label">{{ t("sidebar.field.persona") }}</span>
            <p class="read-value multiline">{{ activeCharacter.personaPrompt || t("sidebar.empty") }}</p>
          </div>
          <div class="read-row">
            <span class="field-label">{{ t("sidebar.field.interactionMode") }}</span>
            <p class="read-value">{{ interactionModeLabel(activeCharacter.interactionMode) }}</p>
          </div>
          <div class="read-row">
            <span class="field-label">{{ t("sidebar.field.language") }}</span>
            <p class="read-value">{{ languageLabel(activeCharacter.language) }}</p>
          </div>

          <div class="actions">
            <button class="mini-btn primary" :disabled="isSavingCharacter" @click="emit('character:start-edit')">{{ t("sidebar.action.startEdit") }}</button>
            <button class="mini-btn danger" :disabled="isSavingCharacter" @click="emit('character:remove')">{{ t("common.delete") }}</button>
          </div>
        </template>
      </template>

      <template v-else>
        <button class="mini-btn primary" :disabled="isSavingCharacter" @click="emit('character:create')">{{ t("sidebar.action.create") }}</button>
      </template>
    </div>
  </section>
</template>

<style scoped>
.group {
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  overflow: hidden;
  background: #fff;
}

.group-header {
  width: 100%;
  border: none;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  padding: 8px 10px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  cursor: pointer;
  background: #eef2ff;
  color: #3730a3;
}

.group-body {
  padding: 8px 8px 8px 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  border-left: 2px solid #c7d2fe;
}

.group-body.compact {
  gap: 5px;
}

.row-inline {
  display: flex;
  align-items: center;
  gap: 6px;
}

.row-inline--between {
  justify-content: space-between;
}

.current-name {
  flex: 1;
  font-size: 11px;
  color: #111827;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.current-id {
  font-size: 10px;
  color: #6b7280;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  user-select: text;
  white-space: nowrap;
}

.field-label {
  font-size: 10px;
  color: #6b7280;
}

.input,
.textarea {
  width: 100%;
  box-sizing: border-box;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  font-size: 11px;
  padding: 4px 6px;
  font-family: inherit;
}

.select {
  width: 100%;
  box-sizing: border-box;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  font-size: 11px;
  padding: 4px 6px;
  font-family: inherit;
  background: #fff;
}

.textarea {
  resize: vertical;
  line-height: 1.35;
}

.hint {
  margin: 0;
  font-size: 11px;
  color: #9ca3af;
}

.actions {
  display: flex;
  gap: 6px;
}

.read-row {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.read-value {
  margin: 0;
  font-size: 11px;
  color: #111827;
  line-height: 1.35;
}

.read-value.multiline {
  white-space: pre-wrap;
  word-break: break-word;
}

.mini-btn {
  border: 1px solid #d1d5db;
  background: #fff;
  border-radius: 6px;
  padding: 3px 8px;
  font-size: 11px;
  color: #374151;
  cursor: pointer;
}

.mini-btn.primary {
  background: #eff6ff;
  border-color: #bfdbfe;
  color: #1d4ed8;
}

.mini-btn.danger {
  color: #b91c1c;
}

.mini-btn:disabled {
  opacity: 0.5;
  cursor: default;
}
</style>
