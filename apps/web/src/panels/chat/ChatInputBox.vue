<script setup lang="ts">
import { computed } from "vue";
import Button from "../../shared/ui/Button.vue";
import { useLocalStorage } from "../../shared/ui/useLocalStorage";
import { t } from "../../shared/i18n/i18n";

const props = defineProps<{
  disabled?: boolean;
  modelValue?: string;
  actors?: Array<{ id: string; displayName: string }>;
  selectedActorId?: string | null;
}>();

const emit = defineEmits<{
  send: [text: string, stream: boolean];
  "update:modelValue": [value: string];
  "update:selectedActorId": [actorId: string];
}>();

const text = computed({
  get: () => props.modelValue ?? "",
  set: (value: string) => emit("update:modelValue", value),
});
const streamMode = useLocalStorage("chat.streamMode", false);

function submit() {
  const value = text.value.trim();
  if (!value || props.disabled) {
    return;
  }

  emit("send", value, streamMode.value);
  text.value = "";
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    submit();
  }
}
</script>

<template>
  <footer class="chat-input-box">
    <textarea
      v-model="text"
      :disabled="disabled"
      class="chat-input"
      :placeholder="t('chat.input.placeholder')"
      @keydown="onKeydown"
    />
    <div class="toolbar">
      <div class="toolbar-left">
        <label class="stream-toggle">
          <input type="checkbox" v-model="streamMode" :disabled="disabled" />
          {{ t("chat.stream") }}
        </label>
        <label class="actor-selector">
          <span>{{ t("chat.sendAs") }}</span>
          <select
            :disabled="disabled || !props.actors?.length"
            :value="props.selectedActorId ?? ''"
            @change="emit('update:selectedActorId', ($event.target as HTMLSelectElement).value)"
          >
            <option v-if="!props.selectedActorId" value="" disabled>{{ t("chat.selectActor") }}</option>
            <option v-for="actor in props.actors" :key="actor.id" :value="actor.id">
              {{ actor.displayName }}
            </option>
          </select>
        </label>
      </div>
      <div class="toolbar-right">
        <Button :disabled="disabled" @click="submit">{{ t("chat.send") }}</Button>
      </div>
    </div>
  </footer>
</template>

<style scoped>
.chat-input-box {
  display: flex;
  flex: 0 0 auto;
  flex-direction: column;
  gap: 6px;
  padding: 8px 12px 10px;
  border-top: 1px solid #e5e7eb;
  background: #fff;
}

.chat-input {
  width: 100%;
  min-height: 68px;
  border: 1px solid #d1d5db;
  border-radius: 8px;
  padding: 8px;
  resize: vertical;
  font: inherit;
  box-sizing: border-box;
}

.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.toolbar-left {
  display: flex;
  align-items: center;
  gap: 10px;
}

.stream-toggle {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  color: #6b7280;
  cursor: pointer;
  user-select: none;
}

.toolbar-right {
  display: flex;
  align-items: center;
  gap: 6px;
}

.actor-selector {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: #6b7280;
}

.actor-selector select {
  border: 1px solid #d1d5db;
  border-radius: 6px;
  padding: 2px 8px;
  background: #fff;
  color: #374151;
  font-size: 12px;
}

.actor-selector select:disabled {
  opacity: 0.6;
}

</style>
