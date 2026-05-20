<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useLocalStorage } from "../../shared/ui/useLocalStorage";
import { activeCharacter, activeCharacterId } from "../character/useCharacterViewModel";
import { activeConversationId } from "../sidebar/viewmodels/useConversationViewModel";
import { actors, selectedActorId, useActorViewModel } from "../sidebar/viewmodels/useActorViewModel";
import { apiDryRunChat } from "../chat/chatApi";
import { chatDraftInput } from "../chat/useChatViewModel";
import { t } from "../../shared/i18n/i18n";

const { updateActor } = useActorViewModel();

const actorPanelOpen = useLocalStorage("ui.right.actorPanelOpen", true);
const promptPanelOpen = useLocalStorage("ui.right.promptPanelOpen", true);
const autoPreview = useLocalStorage("ui.right.autoPromptPreview", false);
const showDebug = useLocalStorage("chat.showDebug", false);
const streamMode = useLocalStorage("chat.streamMode", false);

const editingName = ref("");
const editingDescription = ref("");
const editingBackground = ref("");
const snapshotBase = ref<Record<string, unknown> | null>(null);

const previewText = ref("");
const previewError = ref<string | null>(null);
const isRefreshing = ref(false);
const lastPreviewKey = ref("");
const previewUpdatedAt = ref<string | null>(null);

let intervalId: ReturnType<typeof setInterval> | null = null;

const selectedActor = computed(() =>
  actors.value.find((actor) => actor.id === selectedActorId.value) ?? null,
);

const canEditActor = computed(() => selectedActor.value?.sourceType === "local_actor");

function parseSnapshotObject(profileSnapshotJson: string | null): Record<string, unknown> | null {
  if (!profileSnapshotJson) return null;
  try {
    const parsed = JSON.parse(profileSnapshotJson);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Keep read-only fallback safe for legacy invalid values.
  }
  return null;
}

function pickString(record: Record<string, unknown> | null, key: "description" | "background"): string {
  if (!record) return "";
  const value = record[key];
  return typeof value === "string" ? value : "";
}

function buildProfileSnapshotJson(description: string, background: string, base: Record<string, unknown> | null): string | null {
  const next = { ...(base ?? {}) };
  const cleanDescription = description.trim();
  const cleanBackground = background.trim();

  if (cleanDescription) next.description = cleanDescription;
  else delete next.description;

  if (cleanBackground) next.background = cleanBackground;
  else delete next.background;

  return Object.keys(next).length > 0 ? JSON.stringify(next) : null;
}

function loadActorForm() {
  const actor = selectedActor.value;
  if (!actor) {
    editingName.value = "";
    editingDescription.value = "";
    editingBackground.value = "";
    snapshotBase.value = null;
    return;
  }

  const snapshot = parseSnapshotObject(actor.profileSnapshotJson);
  snapshotBase.value = snapshot;
  editingName.value = actor.displayName;
  editingDescription.value = pickString(snapshot, "description");
  editingBackground.value = pickString(snapshot, "background");
}

async function saveActor() {
  const actor = selectedActor.value;
  if (!actor || !canEditActor.value) return;

  const profileSnapshotJson = buildProfileSnapshotJson(
    editingDescription.value,
    editingBackground.value,
    snapshotBase.value,
  );

  await updateActor({
    actorId: actor.id,
    displayName: editingName.value.trim(),
    profileSnapshotJson,
  });

  loadActorForm();
  lastPreviewKey.value = "";
}

function currentPreviewKey(): string {
  return [
    activeCharacterId.value ?? "",
    activeConversationId.value ?? "",
    selectedActorId.value ?? "",
    streamMode.value ? "non-structured" : "structured",
    chatDraftInput.value.trim(),
  ].join("::");
}

function buildPreviewText(messages: Array<{ role: string; content: string }>): string {
  return messages
    .map((message) => `--- [${message.role}] ---\n${message.content}`)
    .join("\n\n");
}

async function refreshPromptPreview(force = false) {
  const characterId = activeCharacterId.value;
  const conversationId = activeConversationId.value;
  const senderActorId = selectedActorId.value;
  const userMessageText = chatDraftInput.value.trim();

  if (!characterId || !conversationId || !senderActorId || !userMessageText) {
    if (force) {
      previewError.value = t("inspector.error.missingContext");
      previewText.value = "";
      previewUpdatedAt.value = null;
    }
    return;
  }

  const key = currentPreviewKey();
  if (!force && key === lastPreviewKey.value) {
    return;
  }
  if (isRefreshing.value) {
    return;
  }

  isRefreshing.value = true;
  previewError.value = null;
  try {
    const llmResponseMode = streamMode.value ? "non-structured" : "structured";
    const result = await apiDryRunChat(characterId, conversationId, userMessageText, senderActorId, llmResponseMode);
    previewText.value = buildPreviewText(result.messages);
    previewUpdatedAt.value = new Date().toLocaleTimeString();
    lastPreviewKey.value = key;
  } catch (error) {
    previewError.value = error instanceof Error ? error.message : String(error);
  } finally {
    isRefreshing.value = false;
  }
}

watch(selectedActorId, () => {
  loadActorForm();
  lastPreviewKey.value = "";
});

watch(chatDraftInput, () => {
  if (autoPreview.value) {
    void refreshPromptPreview(false);
  }
});

watch(streamMode, () => {
  lastPreviewKey.value = "";
  if (autoPreview.value) {
    void refreshPromptPreview(false);
  }
});

watch([activeCharacterId, activeConversationId], () => {
  lastPreviewKey.value = "";
  previewText.value = "";
  previewError.value = null;
  previewUpdatedAt.value = null;
});

onMounted(() => {
  loadActorForm();
  intervalId = setInterval(() => {
    if (!autoPreview.value) return;
    void refreshPromptPreview(false);
  }, 4000);
});

onBeforeUnmount(() => {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
});
</script>

<template>
  <div class="inspector">
    <section class="group group--prompt">
      <button class="group-header" @click="promptPanelOpen = !promptPanelOpen">
        <span>{{ t("inspector.section.promptPreview") }}</span>
        <span>{{ promptPanelOpen ? "▾" : "▸" }}</span>
      </button>
      <div v-if="promptPanelOpen" class="group-body compact">
        <label class="checkbox-row">
          <input v-model="autoPreview" type="checkbox" />
          <span>{{ t("inspector.autoPreview") }}</span>
        </label>

        <div class="actions">
          <button class="mini-btn" :disabled="isRefreshing" @click="refreshPromptPreview(true)">
            {{ isRefreshing ? t("inspector.refreshing") : t("inspector.refreshNow") }}
          </button>
          <span v-if="previewUpdatedAt" class="hint">{{ t("inspector.updatedAt", { time: previewUpdatedAt }) }}</span>
        </div>

        <p v-if="previewError" class="error">{{ previewError }}</p>
        <pre v-else class="preview">{{ previewText || t("inspector.noPreview") }}</pre>
      </div>
    </section>

    <section class="group group--actor">
      <button class="group-header" @click="actorPanelOpen = !actorPanelOpen">
        <span>{{ t("inspector.section.actorEditor") }}</span>
        <span>{{ actorPanelOpen ? "▾" : "▸" }}</span>
      </button>
      <div v-if="actorPanelOpen" class="group-body compact">
        <template v-if="showDebug">
          <label class="field-label">{{ t("inspector.field.characterId") }}</label>
          <p class="id-text">{{ activeCharacter?.id ?? t("inspector.none") }}</p>

          <label class="field-label">{{ t("inspector.field.conversationId") }}</label>
          <p class="id-text">{{ activeConversationId ?? t("inspector.none") }}</p>
        </template>

        <p v-if="!selectedActor" class="hint">{{ t("inspector.hint.selectActor") }}</p>

        <template v-else>
          <template v-if="showDebug">
            <label class="field-label">{{ t("inspector.field.actorId") }}</label>
            <p class="id-text">{{ selectedActor.id }}</p>
          </template>
          <p class="hint">{{ t("inspector.sourceType") }}: {{ selectedActor.sourceType }}</p>

          <template v-if="canEditActor">
            <label class="field-label">{{ t("inspector.field.name") }}</label>
            <input v-model="editingName" class="input" />

            <label class="field-label">{{ t("inspector.field.description") }}</label>
            <textarea v-model="editingDescription" class="textarea" rows="3" />

            <label class="field-label">{{ t("inspector.field.background") }}</label>
            <textarea v-model="editingBackground" class="textarea" rows="3" />

            <div class="actions">
              <button class="mini-btn primary" :disabled="!editingName.trim()" @click="saveActor">{{ t("inspector.saveActor") }}</button>
            </div>
          </template>

          <template v-else>
            <p class="readonly">{{ t("inspector.actorReadonly") }}</p>
            <pre class="snapshot">{{ selectedActor.profileSnapshotJson || t("inspector.emptySnapshot") }}</pre>
          </template>
        </template>
      </div>
    </section>
  </div>
</template>

<style scoped>
.inspector {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: auto;
  background: #f8fafc;
  padding: 8px;
  gap: 8px;
}

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
}

.group--actor .group-header {
  background: #eef2ff;
  color: #3730a3;
}

.group--prompt .group-header {
  background: #ecfeff;
  color: #155e75;
}

.group-body {
  padding: 8px 8px 8px 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.group--actor .group-body {
  border-left: 2px solid #c7d2fe;
}

.group--prompt .group-body {
  border-left: 2px solid #99f6e4;
}

.group-body.compact {
  gap: 5px;
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

.textarea {
  resize: vertical;
  line-height: 1.4;
}

.checkbox-row {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: #4b5563;
}

.actions {
  display: flex;
  align-items: center;
  gap: 8px;
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

.mini-btn:disabled {
  opacity: 0.5;
  cursor: default;
}

.hint {
  margin: 0;
  font-size: 11px;
  color: #9ca3af;
}

.id-text {
  margin: 0;
  font-size: 11px;
  color: #6b7280;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  user-select: text;
  word-break: break-all;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  background: #f9fafb;
  padding: 6px 8px;
}

.readonly {
  margin: 0;
  font-size: 11px;
  color: #6b7280;
}

.snapshot,
.preview {
  margin: 0;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  background: #f9fafb;
  padding: 8px;
  white-space: pre-wrap;
  font-size: 11px;
  line-height: 1.45;
  color: #374151;
  max-height: 320px;
  overflow: auto;
}

.error {
  margin: 0;
  font-size: 11px;
  color: #b91c1c;
}
</style>
