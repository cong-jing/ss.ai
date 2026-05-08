<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from "vue";
import ChatPanel from "../panels/chat/ChatPanel.vue";
import CharacterPanel from "../panels/character/CharacterPanel.vue";
import ConversationList from "../panels/conversation/ConversationList.vue";
import UserPreferencePopup from "../panels/userPreference/UserPreferencePopup.vue";
import { useCharacterViewModel } from "../panels/character/useCharacterViewModel";

const { load } = useCharacterViewModel();
onMounted(() => { void load(); });

// ── Resizable panels ──────────────────────────────────────────────────────────

const LS_KEY_LEFT  = "ui.leftPanelWidth";
const LS_KEY_RIGHT = "ui.rightPanelWidth";
const MIN = 160;
const MAX = 480;

function clamp(v: number) { return Math.max(MIN, Math.min(MAX, v)); }
function loadWidth(key: string, def: number): number {
  const s = localStorage.getItem(key);
  return s ? clamp(parseInt(s, 10)) : def;
}

const leftWidth  = ref(loadWidth(LS_KEY_LEFT,  220));
const rightWidth = ref(loadWidth(LS_KEY_RIGHT, 280));

type Side = "left" | "right";
let dragging: Side | null = null;
let startX = 0;
let startWidth = 0;

function onMouseDown(e: MouseEvent, side: Side) {
  dragging = side;
  startX = e.clientX;
  startWidth = side === "left" ? leftWidth.value : rightWidth.value;
  document.addEventListener("mousemove", onMouseMove);
  document.addEventListener("mouseup", onMouseUp);
  e.preventDefault();
}

function onMouseMove(e: MouseEvent) {
  if (!dragging) return;
  const delta = e.clientX - startX;
  if (dragging === "left") {
    leftWidth.value = clamp(startWidth + delta);
  } else {
    rightWidth.value = clamp(startWidth - delta);
  }
}

function onMouseUp() {
  if (!dragging) return;
  localStorage.setItem(LS_KEY_LEFT,  String(leftWidth.value));
  localStorage.setItem(LS_KEY_RIGHT, String(rightWidth.value));
  dragging = null;
  document.removeEventListener("mousemove", onMouseMove);
  document.removeEventListener("mouseup", onMouseUp);
}

onBeforeUnmount(() => {
  document.removeEventListener("mousemove", onMouseMove);
  document.removeEventListener("mouseup", onMouseUp);
});
</script>

<template>
  <main class="home-page">

    <!-- LEFT: Conversation list -->
    <aside class="conversations-area" :style="{ width: leftWidth + 'px', minWidth: leftWidth + 'px' }">
      <ConversationList />
    </aside>

    <!-- LEFT resize handle -->
    <div class="resize-handle" @mousedown="onMouseDown($event, 'left')" />

    <!-- CENTER: Chat -->
    <section class="chat-area">
      <ChatPanel />
    </section>

    <!-- RIGHT resize handle -->
    <div class="resize-handle" @mousedown="onMouseDown($event, 'right')" />

    <!-- RIGHT: Character editor + Settings trigger -->
    <aside class="info-area" :style="{ width: rightWidth + 'px', minWidth: rightWidth + 'px' }">
      <div class="info-scrollable">
        <CharacterPanel />
      </div>
      <UserPreferencePopup />
    </aside>

  </main>
</template>

<style scoped>
.home-page {
    display: flex;
    width: 100%;
    height: 100vh;
    min-height: 0;
    overflow: hidden;
}

.conversations-area {
    border-right: none;
    background: #ffffff;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    flex-shrink: 0;
}

.chat-area {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    background: #f9fafb;
}

.info-area {
    border-left: none;
    background: #ffffff;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    flex-shrink: 0;
}

.info-scrollable {
    flex: 1;
    overflow-y: auto;
    min-height: 0;
}

.resize-handle {
    flex-shrink: 0;
    width: 5px;
    background: #e5e7eb;
    cursor: col-resize;
    transition: background 0.15s;
    z-index: 10;
}

.resize-handle:hover,
.resize-handle:active {
    background: #a5b4fc;
}
</style>

