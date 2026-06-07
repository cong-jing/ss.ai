<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import ChatMessageBlock from "./ChatMessageBlock.vue";
import type { ChatMessage } from "./chatTypes";

const props = defineProps<{
  messages: ChatMessage[];
  showDebug?: boolean;
}>();

const emit = defineEmits<{
  reachTop: [];
  reachBottom: [];
  deleteMessage: [messageId: string];
}>();

const listEl = ref<HTMLElement | null>(null);
let resizeObserver: ResizeObserver | null = null;

function scrollToBottom() {
  const el = listEl.value;
  if (!el) return;
  el.scrollTop = el.scrollHeight;
}

async function handleDebugToggle() {
  await nextTick();
  requestAnimationFrame(scrollToBottom);
}

function observeMessageBlocks() {
  const el = listEl.value;
  if (!el || !resizeObserver) return;

  resizeObserver.disconnect();
  for (const child of el.children) {
    resizeObserver.observe(child);
  }
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
    return `${props.messages.length}:${last?.content?.length ?? 0}:${props.showDebug ? 1 : 0}`;
  },
  async () => {
    await nextTick();
    observeMessageBlocks();
    scrollToBottom();
  }
);

onMounted(() => {
  resizeObserver = new ResizeObserver(() => {
    requestAnimationFrame(scrollToBottom);
  });
  observeMessageBlocks();
});

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  resizeObserver = null;
});
</script>

<template>
  <section ref="listEl" class="message-list" @scroll="onScroll">
    <template v-for="(message, index) in messages" :key="message.id ?? `msg-${index}-${message.role}`">
      <ChatMessageBlock
        v-if="message.role !== 'debug' || props.showDebug"
        :message="message"
        :show-debug="props.showDebug"
        @delete-message="emit('deleteMessage', $event)"
        @debug-toggle="handleDebugToggle"
      />
    </template>
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
