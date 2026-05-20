<script setup lang="ts">
import { ref } from 'vue'
import PopupWindow from '../ui/PopupWindow.vue'
import Button from '../ui/Button.vue'
import { debugActions } from './debugActions'
import { useToast } from '../ui/useToast'

const showMenu = ref(false)
const showDemoModal = ref(false)
const showDemoDraggable = ref(false)
const toast = useToast()

function runAction(action: { run: () => void }) {
  showMenu.value = false
  action.run()
}
</script>

<template>
  <!-- Fixed trigger button (bottom-right) -->
  <div class="debug-trigger">
    <button class="debug-btn" @click="showMenu = !showMenu">Debug</button>
  </div>

  <!-- Debug menu popup: anchored above the trigger button -->
  <PopupWindow
    v-model="showMenu"
    :show-header="false"
    :modal="false"
    :close-on-click-outside="true"
    :draggable="false"
    placement="bottom-right"
    :offset-x="16"
    :offset-y="52"
    width="200px"
  >
    <div class="debug-actions">
      <p class="debug-section-label">Popup demos</p>
      <Button size="sm" @click="showDemoModal = true; showMenu = false">
        Test: Modal popup
      </Button>
      <Button size="sm" @click="showDemoDraggable = true; showMenu = false">
        Test: Draggable popup
      </Button>

      <hr class="debug-divider" />
      <p class="debug-section-label">Toast demos</p>
      <Button size="sm" @click="toast.error('Something went wrong. This is an error toast.'); showMenu = false">
        Test: Error toast
      </Button>
      <Button size="sm" @click="toast.success('Saved successfully!'); showMenu = false">
        Test: Success toast
      </Button>
      <Button size="sm" @click="toast.info('Here is some information.'); showMenu = false">
        Test: Info toast
      </Button>

      <!-- Externally registered actions -->
      <template v-if="debugActions.length > 0">
        <hr class="debug-divider" />
        <p class="debug-section-label">Registered actions</p>
        <Button
          v-for="(action, i) in debugActions"
          :key="i"
          size="sm"
          @click="runAction(action)"
        >
          {{ action.label }}
        </Button>
      </template>
    </div>
  </PopupWindow>

  <!-- Demo: modal popup -->
  <PopupWindow v-model="showDemoModal" title="Demo: Modal Popup" :modal="true" width="400px">
    <p class="demo-text">
      This is a modal popup. Click overlay, top-right close button, or press Esc to close.
    </p>
  </PopupWindow>

  <!-- Demo: draggable non-modal popup -->
  <PopupWindow
    v-model="showDemoDraggable"
    title="Demo: Draggable Popup"
    :modal="false"
    :draggable="true"
    width="360px"
  >
    <p class="demo-text">
      This is a non-modal draggable popup. Drag from the title bar to move it.
    </p>
  </PopupWindow>
</template>

<style scoped>
.debug-trigger {
  position: fixed;
  bottom: 16px;
  right: 16px;
  z-index: 900;
}

.debug-btn {
  padding: 5px 14px;
  background: #1e293b;
  color: #f8fafc;
  border: none;
  border-radius: 6px;
  font-size: 12px;
  font-family: inherit;
  cursor: pointer;
  opacity: 0.75;
}

.debug-btn:hover {
  opacity: 1;
}

.debug-actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.debug-section-label {
  margin: 0;
  font-size: 11px;
  font-weight: 600;
  color: #9ca3af;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.debug-divider {
  border: none;
  border-top: 1px solid #e5e7eb;
  margin: 2px 0;
}

.demo-text {
  margin: 0;
  font-size: 13px;
  color: #374151;
  line-height: 1.6;
}

kbd {
  display: inline-block;
  padding: 1px 5px;
  font-size: 11px;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  background: #f9fafb;
}
</style>
