<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from "vue";
import ChatPanel from "../panels/chat/ChatPanel.vue";
import LeftSidebar from "../panels/sidebar/LeftSidebar.vue";
import ContextInspectorPanel from "../panels/inspector/ContextInspectorPanel.vue";
import UserPreferencePopup from "../panels/userPreference/UserPreferencePopup.vue";
import { useCharacterViewModel } from "../panels/character/useCharacterViewModel";
import { useLocalStorage } from "../shared/ui/useLocalStorage";

const { load } = useCharacterViewModel();
onMounted(() => { void load(); });

// ── Resizable panels ──────────────────────────────────────────────────────────

const MIN = 160;
const MAX = 480;

function clamp(v: number) { return Math.max(MIN, Math.min(MAX, v)); }

const leftWidth  = useLocalStorage("ui.leftPanelWidth",  220);
const rightWidth = useLocalStorage("ui.rightPanelWidth", 280);

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

    <!-- LEFT: Workspace sidebar -->
    <aside class="conversations-area" :style="{ width: leftWidth + 'px', minWidth: leftWidth + 'px' }">
      <LeftSidebar />
    </aside>

    <!-- LEFT resize handle -->
    <div class="resize-handle" @mousedown="onMouseDown($event, 'left')" />

    <!-- CENTER: Chat -->
    <section class="chat-area">
      <ChatPanel />
    </section>

    <!-- RIGHT resize handle -->
    <div class="resize-handle" @mousedown="onMouseDown($event, 'right')" />

    <!-- RIGHT: Context inspector + Settings trigger -->
    <aside class="info-area" :style="{ width: rightWidth + 'px', minWidth: rightWidth + 'px' }">
      <div class="info-scrollable">
        <ContextInspectorPanel />
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

