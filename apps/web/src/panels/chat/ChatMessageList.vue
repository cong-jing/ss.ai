<script setup lang="ts">
import { nextTick, ref, watch } from "vue";
import ChatMessageBlock from "./ChatMessageBlock.vue";
import type { ChatMessage } from "./chatTypes";

const props = defineProps<{
  messages: ChatMessage[];
}>();

const emit = defineEmits<{
  reachTop: [];
  reachBottom: [];
}>();

const listEl = ref<HTMLElement | null>(null);

function scrollToBottom() {
  const el = listEl.value;
  if (!el) return;
  el.scrollTop = el.scrollHeight;
}

function onScroll() {
  const el = listEl.value;
  if (!el) return;

  if (el.scrollTop === 0) {
    emit("reachTop");
  }

  if (el.scrollTop + el.clientHeight >= el.scrollHeight - 1) {
    emit("reachBottom");
  }
}

watch(
  () => {
    const last = props.messages[props.messages.length - 1];
    return `${props.messages.length}:${last?.content?.length ?? 0}`;
  },
  async () => {
    await nextTick();
    scrollToBottom();
  }
);
</script>

<template>
  <section ref="listEl" class="message-list" @scroll="onScroll">
    <ChatMessageBlock v-for="message in messages" :key="message.id" :message="message" />
  </section>
</template>

<style scoped>
.message-list {
  gap: 8px;
  padding: 12px;

  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  overflow-y: auto;
  min-height: 0;
}
</style>
