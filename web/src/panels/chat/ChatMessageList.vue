<script setup lang="ts">
import { nextTick, ref, watch } from "vue";
import ChatMessageBlock from "./ChatMessageBlock.vue";
import type { ChatMessage } from "./chatTypes";

const props = defineProps<{
  messages: ChatMessage[];
}>();

const listEl = ref<HTMLElement | null>(null);

function scrollToBottom() {
  const el = listEl.value;
  if (!el) {
    return;
  }

  el.scrollTop = el.scrollHeight;
}

watch(
  () => props.messages.length,
  async () => {
    await nextTick();
    scrollToBottom();
  }
);
</script>

<template>
  <section ref="listEl" class="message-list">
    <ChatMessageBlock v-for="message in messages" :key="message.id" :message="message" />
  </section>
</template>

<style scoped>
.message-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  height: 100%;
  overflow-y: auto;
  padding: 12px;
}
</style>
