<script setup lang="ts">
import type { Character } from "@ss-ai/contracts";

const props = defineProps<{
  isOpen: boolean;
  activeCharacter: Character | null;
  editDraft: {
    name: string;
    displayName: string;
    description: string;
    personaPrompt: string;
  };
  isDirty: boolean;
  isSavingCharacter: boolean;
  newCharacterName: string;
}>();

const emit = defineEmits<{
  "character:toggle-open": [];
  "character:open-picker": [];
  "character:update-new-name": [value: string];
  "character:create": [];
  "character:save": [];
  "character:remove": [];
}>();
</script>

<template>
  <section class="group group--character">
    <button class="group-header" @click="emit('character:toggle-open')">
      <span>角色</span>
      <span>{{ isOpen ? "▾" : "▸" }}</span>
    </button>

    <div v-if="isOpen" class="group-body compact">
      <div class="row-inline row-inline--between">
        <button class="mini-btn" @click="emit('character:open-picker')">切换</button>
        <template v-if="activeCharacter">
          <span class="current-name" :title="activeCharacter.name">{{ activeCharacter.name }}</span>
          <span class="current-id" :title="activeCharacter.id">{{ activeCharacter.id }}</span>
        </template>
        <span v-else class="hint">未选择角色</span>
      </div>

      <template v-if="activeCharacter">
        <label class="field-label">名称</label>
        <input v-model="props.editDraft.name" class="input" :disabled="isSavingCharacter" />

        <label class="field-label">显示名</label>
        <input v-model="props.editDraft.displayName" class="input" :disabled="isSavingCharacter" placeholder="(可选)" />

        <label class="field-label">描述</label>
        <textarea v-model="props.editDraft.description" class="textarea" rows="2" :disabled="isSavingCharacter" />

        <label class="field-label">Persona</label>
        <textarea v-model="props.editDraft.personaPrompt" class="textarea" rows="3" :disabled="isSavingCharacter" />

        <div class="actions">
          <button
            class="mini-btn primary"
            :disabled="isSavingCharacter || !isDirty || !props.editDraft.name.trim()"
            @click="emit('character:save')"
          >
            保存
          </button>
          <button class="mini-btn danger" :disabled="isSavingCharacter" @click="emit('character:remove')">删除</button>
        </div>
      </template>

      <template v-else>
        <label class="field-label">新角色名称</label>
        <input
          :value="newCharacterName"
          class="input"
          :disabled="isSavingCharacter"
          @input="emit('character:update-new-name', ($event.target as HTMLInputElement).value)"
          @keydown.enter.prevent="emit('character:create')"
        />
        <button class="mini-btn primary" :disabled="isSavingCharacter || !newCharacterName.trim()" @click="emit('character:create')">创建</button>
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
