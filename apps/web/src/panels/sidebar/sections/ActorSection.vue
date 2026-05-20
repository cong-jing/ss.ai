<script setup lang="ts">
import type { ConversationActor } from "../../conversation/conversationApi";
import { useLocalStorage } from "../../../shared/ui/useLocalStorage";
import { t } from "../../../shared/i18n/i18n";

defineProps<{
  isOpen: boolean;
  activeConversationId: string | null;
  isLoadingActors: boolean;
  isSavingActor: boolean;
  actors: ConversationActor[];
  selectedActorId: string | null;
}>();

const emit = defineEmits<{
  "actor:toggle-open": [];
  "actor:create": [];
  "actor:select": [id: string];
  "actor:delete": [id: string];
}>();

const showDebug = useLocalStorage("chat.showDebug", false);
</script>

<template>
  <section class="group group--actor">
    <button class="group-header" @click="emit('actor:toggle-open')">
      <span>{{ t("sidebar.actor") }}</span>
      <span>{{ isOpen ? "▾" : "▸" }}</span>
    </button>

    <div v-if="isOpen" class="group-body">
      <p v-if="!activeConversationId" class="hint">{{ t("sidebar.selectConversationFirst") }}</p>
      <template v-else>
        <button class="mini-btn" :disabled="isSavingActor" @click="emit('actor:create')">{{ t("sidebar.addActor") }}</button>

        <p v-if="isLoadingActors" class="hint">{{ t("common.loading") }}</p>
        <p v-else-if="actors.length === 0" class="hint">{{ t("sidebar.noActors") }}</p>

        <div
          v-for="actor in actors"
          :key="actor.id"
          class="actor-row"
          :class="{ active: actor.id === selectedActorId }"
        >
          <button class="actor-main" @click="emit('actor:select', actor.id)">
            <span class="actor-name">{{ actor.displayName }}</span>
            <span class="actor-meta-row">
              <span class="actor-type" :class="`actor-type--${actor.sourceType}`">{{ actor.sourceType }}</span>
              <span v-if="showDebug" class="actor-id">{{ actor.id }}</span>
            </span>
          </button>
          <button
            v-if="actor.sourceType === 'local_actor'"
            class="actor-delete"
            :disabled="isSavingActor"
            @click="emit('actor:delete', actor.id)"
          >
            ✕
          </button>
        </div>
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
  background: #fef3c7;
  color: #92400e;
}

.group-body {
  padding: 8px 8px 8px 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  border-left: 2px solid #fcd34d;
}

.hint {
  margin: 0;
  font-size: 11px;
  color: #9ca3af;
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

.mini-btn:disabled {
  opacity: 0.5;
  cursor: default;
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

.actor-meta-row {
  margin-top: 2px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
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
