<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'

const props = withDefaults(defineProps<{
  title?: string
  /** 是否显示遮罩层（模态）。默认 true */
  modal?: boolean
  /** 点击弹窗外部区域关闭（不暗化背景）。modal=false 时有效。默认 false */
  closeOnClickOutside?: boolean
  /** 是否显示标题栏（含关闭按钮）。默认 true */
  showHeader?: boolean
  /** 是否允许拖拽移动。默认 false */
  draggable?: boolean
  width?: string
  /**
   * 初始定位方式。
   * 'center'（默认）：居中显示
   * 'bottom-right'：从右下角锚定，配合 offsetX/offsetY 使用
   */
  placement?: 'center' | 'bottom-right'
  /** placement='bottom-right' 时距右边缘的像素距离，默认 16 */
  offsetX?: number
  /** placement='bottom-right' 时距下边缘的像素距离，默认 16 */
  offsetY?: number
}>(), {
  modal: true,
  closeOnClickOutside: false,
  showHeader: true,
  draggable: false,
  width: '480px',
  placement: 'center',
  offsetX: 16,
  offsetY: 16,
})

const model = defineModel<boolean>({ required: true })

// --- Drag state ---
const popupEl = ref<HTMLElement | null>(null)
const hasMoved = ref(false)
const pos = ref({ x: 0, y: 0 })

let dragging = false
let startMouse = { x: 0, y: 0 }
let startPos = { x: 0, y: 0 }

const popupStyle = computed(() => {
  const base: Record<string, string> = { width: props.width }
  if (hasMoved.value) {
    return { ...base, left: `${pos.value.x}px`, top: `${pos.value.y}px` }
  }
  if (props.placement === 'bottom-right') {
    return { ...base, bottom: `${props.offsetY}px`, right: `${props.offsetX}px` }
  }
  return base
})

function onHeaderMouseDown(e: MouseEvent) {
  if (!props.draggable) return
  e.preventDefault()

  // First drag: resolve current rendered position and switch to px-based
  if (!hasMoved.value && popupEl.value) {
    const rect = popupEl.value.getBoundingClientRect()
    pos.value = { x: rect.left, y: rect.top }
    hasMoved.value = true
  }

  dragging = true
  startMouse = { x: e.clientX, y: e.clientY }
  startPos = { ...pos.value }
}

function onMouseMove(e: MouseEvent) {
  if (!dragging) return
  pos.value = {
    x: startPos.x + (e.clientX - startMouse.x),
    y: startPos.y + (e.clientY - startMouse.y),
  }
}

function onMouseUp() {
  dragging = false
}

function onKeyDown(e: KeyboardEvent) {
  if (e.key === 'Escape' && model.value) {
    model.value = false
  }
}

// Reset drag position each time the popup re-opens
watch(() => model.value, (val) => {
  if (val) hasMoved.value = false
})

onMounted(() => {
  window.addEventListener('mousemove', onMouseMove)
  window.addEventListener('mouseup', onMouseUp)
  window.addEventListener('keydown', onKeyDown)
})

onUnmounted(() => {
  window.removeEventListener('mousemove', onMouseMove)
  window.removeEventListener('mouseup', onMouseUp)
  window.removeEventListener('keydown', onKeyDown)
})
</script>

<template>
  <Teleport to="body">
    <template v-if="model">

      <!-- Dim backdrop (modal) -->
      <div
        v-if="modal"
        class="popup-backdrop popup-backdrop--dim"
        @click="model = false"
      />

      <!-- Transparent backdrop (closeOnClickOutside, non-modal) -->
      <div
        v-else-if="closeOnClickOutside"
        class="popup-backdrop"
        @click="model = false"
      />

      <!-- Popup window -->
      <div
        ref="popupEl"
        class="popup-window"
        :class="{
          'popup-window--moved': hasMoved,
          'popup-window--bottom-right': !hasMoved && placement === 'bottom-right',
        }"
        :style="popupStyle"
        role="dialog"
        :aria-modal="modal"
        :aria-label="title"
      >
        <div
          v-if="showHeader"
          class="popup-header"
          :class="{ 'popup-header--draggable': draggable }"
          @mousedown="onHeaderMouseDown"
        >
          <span class="popup-title">{{ title }}</span>
          <button class="popup-close" title="Close" @click="model = false">✕</button>
        </div>

        <div class="popup-body">
          <slot />
        </div>

        <div v-if="$slots.footer" class="popup-footer">
          <slot name="footer" />
        </div>
      </div>

    </template>
  </Teleport>
</template>

<style scoped>
.popup-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1000;
}

.popup-backdrop--dim {
  background: rgba(0, 0, 0, 0.35);
}

/* Default: centered via transform */
.popup-window {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  z-index: 1001;
  background: #fff;
  border: 1px solid #d1d5db;
  border-radius: 10px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.18);
  display: flex;
  flex-direction: column;
  max-height: 80vh;
  box-sizing: border-box;
}

/* bottom-right anchored (before first drag) */
.popup-window--bottom-right {
  top: auto;
  left: auto;
  transform: none;
}

/* After first drag: switch to absolute px position, no transform */
.popup-window--moved {
  top: 0;
  left: 0;
  transform: none;
}

.popup-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid #e5e7eb;
  flex-shrink: 0;
}

.popup-header--draggable {
  cursor: move;
  user-select: none;
}

.popup-title {
  font-size: 14px;
  font-weight: 600;
  color: #111827;
}

.popup-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: none;
  background: none;
  cursor: pointer;
  color: #6b7280;
  font-size: 14px;
  border-radius: 4px;
  padding: 0;
  line-height: 1;
}

.popup-close:hover {
  background: #f3f4f6;
  color: #111827;
}

.popup-body {
  padding: 16px;
  overflow-y: auto;
  flex: 1;
}

.popup-footer {
  padding: 12px 16px;
  border-top: 1px solid #e5e7eb;
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  flex-shrink: 0;
}
</style>
