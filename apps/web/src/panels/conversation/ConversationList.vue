<script setup lang="ts">
import { onMounted, ref, watch } from "vue";
import { useLocalStorage } from "../../shared/ui/useLocalStorage";
import { useToast } from "../../shared/ui/useToast";
import ConversationItem from "./ConversationItem.vue";
import CharacterPickerPopup from "../character/CharacterPickerPopup.vue";
import {
  activeCharacter,
  activeCharacterId,
  editDraft,
  isDirty,
  isSavingCharacter,
  useCharacterViewModel,
} from "../character/useCharacterViewModel";
import {
  activeConversationId,
  conversations,
  isLoadingConversations,
  useConversationViewModel,
} from "./useConversationViewModel";
import {
  actors,
  selectedActorId,
  isLoadingActors,
  isSavingActor,
  useActorViewModel,
} from "./useActorViewModel";

const {
  load: loadCharacters,
  create: createCharacter,
  save: saveCharacter,
  remove: removeCharacter,
} = useCharacterViewModel();
const {
  load: loadConversations,
  createConversation,
  selectConversation,
  deleteConversation,
  updateTitle,
} = useConversationViewModel();
const {
  load: loadActors,
  select: selectActor,
  createActor,
  deleteActor,
} = useActorViewModel();

const showPicker = ref(false);
const newCharacterName = ref("");
const toast = useToast();

const characterOpen = useLocalStorage("ui.left.characterOpen", true);
const conversationOpen = useLocalStorage("ui.left.conversationOpen", true);
const actorOpen = useLocalStorage("ui.left.actorOpen", true);

async function onCreateCharacter() {
  const created = await createCharacter(newCharacterName.value, "", "", "", "");
  if (created) {
    newCharacterName.value = "";
    await loadConversations();
    await loadActors();
  }
}

async function onPopupCreateCharacter() {
  const created = await createCharacter("New Character", "", "", "", "");
  showPicker.value = false;
  if (created) {
    await loadConversations();
    await loadActors();
  }
}

async function onSelectConversation(id: string) {
  await selectConversation(id);
  await loadActors();
}

async function onCreateConversation() {
  await createConversation();
  await loadActors();
}

async function onDeleteConversation(id: string) {
  await deleteConversation(id);
  await loadActors();
}

async function onCreateActor() {
  await createActor("new actor");
}

async function onRenameConversation(conversationId: string, title: string | null) {
  if (!activeCharacterId.value) return;
  await updateTitle(conversationId, title);
  toast.success("Conversation title saved");
}

onMounted(() => {
  void loadCharacters();
  if (activeCharacterId.value) {
    void loadConversations();
    void loadActors();
  }
});

watch(activeCharacterId, (id) => {
  if (!id) {
    conversations.value = [];
    activeConversationId.value = null;
    actors.value = [];
    selectedActorId.value = null;
    return;
  }
  void loadConversations().then(() => loadActors());
});

watch(activeConversationId, () => {
  void loadActors();
});
</script>

<template>
  <div class="sidebar">
    <section class="group group--character">
      <button class="group-header" @click="characterOpen = !characterOpen">
        <span>角色</span>
        <span>{{ characterOpen ? "▾" : "▸" }}</span>
      </button>
      <div v-if="characterOpen" class="group-body compact">
        <div class="row-inline row-inline--between">
          <button class="mini-btn" @click="showPicker = true">切换</button>
          <template v-if="activeCharacter">
            <span class="current-name" :title="activeCharacter.name">{{ activeCharacter.name }}</span>
            <span class="current-id" :title="activeCharacter.id">{{ activeCharacter.id }}</span>
          </template>
          <span v-else class="hint">未选择角色</span>
        </div>

        <template v-if="activeCharacter">
          <label class="field-label">名称</label>
          <input v-model="editDraft.name" class="input" :disabled="isSavingCharacter" />

          <label class="field-label">显示名</label>
          <input v-model="editDraft.displayName" class="input" :disabled="isSavingCharacter" placeholder="(可选)" />

          <label class="field-label">描述</label>
          <textarea v-model="editDraft.description" class="textarea" rows="2" :disabled="isSavingCharacter" />

          <label class="field-label">Persona</label>
          <textarea v-model="editDraft.personaPrompt" class="textarea" rows="3" :disabled="isSavingCharacter" />

          <div class="actions">
            <button class="mini-btn primary" :disabled="isSavingCharacter || !isDirty || !editDraft.name.trim()" @click="saveCharacter">
              保存
            </button>
            <button class="mini-btn danger" :disabled="isSavingCharacter" @click="removeCharacter">删除</button>
          </div>
        </template>

        <template v-else>
          <label class="field-label">新角色名称</label>
          <input v-model="newCharacterName" class="input" :disabled="isSavingCharacter" @keydown.enter.prevent="onCreateCharacter" />
          <button class="mini-btn primary" :disabled="isSavingCharacter || !newCharacterName.trim()" @click="onCreateCharacter">创建</button>
        </template>
      </div>
    </section>

    <section class="group group--conversation">
      <button class="group-header" @click="conversationOpen = !conversationOpen">
        <span>对话</span>
        <span>{{ conversationOpen ? "▾" : "▸" }}</span>
      </button>
      <div v-if="conversationOpen" class="group-body">
        <div class="row-inline">
          <button class="mini-btn" :disabled="isLoadingConversations || !activeCharacterId" @click="onCreateConversation">+ 新建</button>
          <span v-if="isLoadingConversations" class="hint">加载中...</span>
        </div>

        <p v-if="!activeCharacterId" class="hint">请先选择角色。</p>
        <p v-else-if="conversations.length === 0" class="hint">暂无对话。</p>

        <ConversationItem
          v-for="conv in conversations"
          :key="conv.id"
          :conversation="conv"
          :is-active="conv.id === activeConversationId"
          @select="onSelectConversation(conv.id)"
          @rename="onRenameConversation(conv.id, $event)"
          @delete="onDeleteConversation(conv.id)"
        />
      </div>
    </section>

    <section class="group group--actor">
      <button class="group-header" @click="actorOpen = !actorOpen">
        <span>Actor</span>
        <span>{{ actorOpen ? "▾" : "▸" }}</span>
      </button>
      <div v-if="actorOpen" class="group-body">
        <p v-if="!activeConversationId" class="hint">请先选择对话。</p>
        <template v-else>
          <button class="mini-btn" :disabled="isSavingActor" @click="onCreateActor">+ 添加 Actor</button>

          <p v-if="isLoadingActors" class="hint">加载中...</p>
          <p v-else-if="actors.length === 0" class="hint">暂无 actor。</p>

          <div
            v-for="actor in actors"
            :key="actor.id"
            class="actor-row"
            :class="{ active: actor.id === selectedActorId }"
          >
            <button class="actor-main" @click="selectActor(actor.id)">
              <span class="actor-name">{{ actor.displayName }}</span>
              <span class="actor-meta-row">
                <span class="actor-type" :class="`actor-type--${actor.sourceType}`">{{ actor.sourceType }}</span>
                <span class="actor-id">{{ actor.id }}</span>
              </span>
            </button>
            <button
              v-if="actor.sourceType === 'local_actor'"
              class="actor-delete"
              :disabled="isSavingActor"
              @click="deleteActor(actor.id)"
            >
              ✕
            </button>
          </div>
        </template>
      </div>
    </section>
  </div>

  <CharacterPickerPopup v-model="showPicker" @new-character="onPopupCreateCharacter" />
</template>

<style scoped>
.sidebar {
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
  background: #f3f4f6;
  font-size: 11px;
  font-weight: 600;
  color: #4b5563;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  padding: 8px 10px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  cursor: pointer;
}

.group--character .group-header {
  background: #eef2ff;
  color: #3730a3;
}

.group--conversation .group-header {
  background: #ecfeff;
  color: #0f766e;
}

.group--actor .group-header {
  background: #fef3c7;
  color: #92400e;
}

.group-body {
  padding: 8px 8px 8px 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  border-left: 2px solid #e5e7eb;
}

.group--character .group-body {
  border-left-color: #c7d2fe;
}

.group--conversation .group-body {
  border-left-color: #99f6e4;
}

.group--actor .group-body {
  border-left-color: #fcd34d;
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
  line-height: 1.35;
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

.hint {
  margin: 0;
  font-size: 11px;
  color: #9ca3af;
}

.actions {
  display: flex;
  gap: 6px;
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

.actor-create {
  display: flex;
  gap: 6px;
}

.actor-row {
  display: flex;
  align-items: center;
  gap: 8px;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  padding: 4px;
  background: #fff;
}

.actor-row.active {
  border-color: #93c5fd;
  background: #eff6ff;
}

.actor-main {
  flex: 1;
  min-width: 0;
  border: none;
  background: none;
  text-align: left;
  cursor: pointer;
}

.actor-name {
  display: block;
  font-size: 11px;
  color: #111827;
}

.actor-type {
  font-size: 10px;
  color: #334155;
  border: 1px solid #cbd5e1;
  border-radius: 999px;
  background: #f8fafc;
  padding: 1px 6px;
  line-height: 1.4;
}

.actor-type--local_actor {
  background: #eff6ff;
  border-color: #bfdbfe;
  color: #1d4ed8;
}

.actor-type--ai_character {
  background: #f0fdf4;
  border-color: #bbf7d0;
  color: #166534;
}

.actor-type--logged_user {
  background: #fff7ed;
  border-color: #fed7aa;
  color: #9a3412;
}

.actor-type--system {
  background: #f3f4f6;
  border-color: #d1d5db;
  color: #4b5563;
}

.actor-meta-row {
  margin-top: 2px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.actor-id {
  font-size: 10px;
  color: #6b7280;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  user-select: text;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.actor-delete {
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  border: none;
  background: none;
  cursor: pointer;
  color: #9ca3af;
  font-size: 11px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
}

.actor-delete:hover:not(:disabled) {
  background: #fee2e2;
  color: #b91c1c;
}

.actor-delete:disabled {
  opacity: 0.5;
  cursor: default;
}
</style>
