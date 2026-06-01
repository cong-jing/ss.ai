<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { DEFAULT_INTERACTION_MODE, INTERACTION_MODE_I18N_KEYS, type CharacterTemplate, type InteractionMode, type PromptLanguage } from "@ss-ai/contracts";
import PopupWindow from "../../shared/ui/PopupWindow.vue";
import Button from "../../shared/ui/Button.vue";
import { apiListCharacterTemplates } from "../userProfile/userProfileApi";
import { locale, t } from "../../shared/i18n/i18n";
import { localizeApiError } from "../../shared/api/localizeApiError";
import { useToast } from "../../shared/ui/useToast";

type CreateDraft = {
    name: string;
    displayName: string;
    description: string;
    personaPrompt: string;
    greetingMessage: string;
    interactionMode: InteractionMode;
    language: PromptLanguage;
};

const props = defineProps<{
    interactionModes: InteractionMode[];
    isSaving: boolean;
}>();

const model = defineModel<boolean>({ required: true });
const emit = defineEmits<{
    "create-character": [draft: CreateDraft];
}>();

const toast = useToast();
const templates = ref<CharacterTemplate[]>([]);
const selectedTemplateId = ref<string>("custom");
const isLoading = ref(false);
const selectedTemplate = computed(() => templates.value.find((item) => item.id === selectedTemplateId.value));
const customDraft = ref<CreateDraft>({
    name: "",
    displayName: "",
    description: "",
    personaPrompt: "",
    greetingMessage: "",
    interactionMode: DEFAULT_INTERACTION_MODE,
    language: "zh-CN",
});
const draft = ref<CreateDraft>({ ...customDraft.value });

const canCreate = computed(() => !isLoading.value && draft.value.name.trim().length > 0 && !props.isSaving);

function interactionModeLabel(mode: InteractionMode): string {
    return t(INTERACTION_MODE_I18N_KEYS[mode]);
}

function languageLabel(language: PromptLanguage): string {
    return t(`settings.language.${language}` as const);
}

function syncDraftFromSelection(): void {
    if (selectedTemplateId.value === "custom") {
        draft.value = { ...customDraft.value };
        return;
    }
    if (!selectedTemplate.value) return;
    draft.value = {
        name: selectedTemplate.value.name,
        displayName: selectedTemplate.value.displayName ?? "",
        description: selectedTemplate.value.description,
        personaPrompt: selectedTemplate.value.personaPrompt,
        greetingMessage: selectedTemplate.value.greetingMessage ?? "",
        interactionMode: selectedTemplate.value.interactionMode,
        language: selectedTemplate.value.language,
    };
}

async function loadTemplates(): Promise<void> {
    isLoading.value = true;
    templates.value = [];
    try {
        templates.value = await apiListCharacterTemplates(locale.value);
        syncDraftFromSelection();
    } catch (error) {
        toast.error(localizeApiError(error));
    } finally {
        isLoading.value = false;
    }
}

function selectTemplate(id: string): void {
    if (selectedTemplateId.value === "custom") {
        customDraft.value = { ...draft.value };
    }
    selectedTemplateId.value = id;
    syncDraftFromSelection();
}

function onCreate(): void {
    if (!canCreate.value) return;
    if (selectedTemplateId.value === "custom") {
        customDraft.value = { ...draft.value };
    }
    emit("create-character", { ...draft.value });
}

watch(model, (open) => {
    if (!open) return;
    selectedTemplateId.value = "custom";
    customDraft.value = {
        name: t("character.defaultName"),
        displayName: "",
        description: "",
        personaPrompt: "",
        greetingMessage: "",
        interactionMode: props.interactionModes[0] ?? DEFAULT_INTERACTION_MODE,
        language: locale.value,
    };
    draft.value = { ...customDraft.value };
    void loadTemplates();
});
</script>

<template>
  <PopupWindow v-model="model" :title="t('characterCreate.title')" :modal="true" width="860px">
    <div class="create-layout">
      <aside class="template-list">
        <button
          v-for="item in templates"
          :key="item.id"
          class="template-item"
          :class="{ active: selectedTemplateId === item.id }"
          @click="selectTemplate(item.id)"
        >
          <p class="template-name">{{ item.name }}</p>
          <p class="template-desc">{{ item.description }}</p>
          <p class="template-meta">{{ interactionModeLabel(item.interactionMode) }} / {{ languageLabel(item.language) }}</p>
        </button>
        <button class="template-item" :class="{ active: selectedTemplateId === 'custom' }" @click="selectTemplate('custom')">
          <p class="template-name">{{ t("characterCreate.customName") }}</p>
          <p class="template-desc">{{ t("characterCreate.customDescription") }}</p>
        </button>
      </aside>

      <section class="detail-panel">
        <p v-if="isLoading" class="hint">{{ t("common.loading") }}</p>
        <template v-else>
          <label class="field-label">{{ t("sidebar.field.name") }}</label>
          <input v-model="draft.name" class="input" :disabled="isSaving" />

          <label class="field-label">{{ t("sidebar.field.displayName") }}</label>
          <input v-model="draft.displayName" class="input" :disabled="isSaving" />

          <label class="field-label">{{ t("sidebar.field.description") }}</label>
          <textarea v-model="draft.description" class="textarea" rows="2" :disabled="isSaving" />

          <label class="field-label">{{ t("sidebar.field.persona") }}</label>
          <textarea v-model="draft.personaPrompt" class="textarea" rows="5" :disabled="isSaving" />

          <label class="field-label">{{ t("characterCreate.field.greetingMessage") }}</label>
          <textarea v-model="draft.greetingMessage" class="textarea" rows="2" :disabled="isSaving" />

          <div class="row">
            <div class="col">
              <label class="field-label">{{ t("sidebar.field.interactionMode") }}</label>
              <select v-model="draft.interactionMode" class="select" :disabled="isSaving">
                <option v-for="mode in props.interactionModes" :key="mode" :value="mode">{{ interactionModeLabel(mode) }}</option>
              </select>
            </div>
            <div class="col">
              <label class="field-label">{{ t("sidebar.field.language") }}</label>
              <select v-model="draft.language" class="select" :disabled="isSaving">
                <option value="zh-CN">{{ t("settings.language.zh-CN") }}</option>
                <option value="en-US">{{ t("settings.language.en-US") }}</option>
                <option value="ja-JP">{{ t("settings.language.ja-JP") }}</option>
              </select>
            </div>
          </div>
        </template>
      </section>
    </div>

    <template #footer>
      <Button size="sm" :disabled="isSaving" @click="model = false">{{ t("common.cancel") }}</Button>
      <Button size="sm" :disabled="!canCreate" @click="onCreate">{{ t("common.create") }}</Button>
    </template>
  </PopupWindow>
</template>

<style scoped>
.create-layout {
  display: grid;
  grid-template-columns: 280px 1fr;
  gap: 12px;
  min-height: 420px;
}

.template-list {
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  overflow: auto;
}

.template-item {
  width: 100%;
  text-align: left;
  border: 1px solid #d1d5db;
  background: #fff;
  border-radius: 6px;
  padding: 8px;
  cursor: pointer;
}

.template-item.active {
  border-color: #93c5fd;
  background: #eff6ff;
}

.template-name {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
}

.template-desc {
  margin: 4px 0 0;
  color: #6b7280;
  font-size: 12px;
}

.template-meta {
  margin: 4px 0 0;
  color: #4b5563;
  font-size: 11px;
}

.detail-panel {
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.field-label {
  font-size: 11px;
  color: #6b7280;
}

.input,
.textarea,
.select {
  width: 100%;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  box-sizing: border-box;
  font-size: 12px;
  padding: 6px 8px;
  font-family: inherit;
}

.row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.col {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.hint {
  margin: 0;
  color: #6b7280;
  font-size: 12px;
}
</style>
