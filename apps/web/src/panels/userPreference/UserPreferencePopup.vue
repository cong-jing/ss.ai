<script setup lang="ts">
import { ref } from 'vue'
import PopupWindow from '../../shared/ui/PopupWindow.vue'
import UserPreferencePanel from './UserPreferencePanel.vue'

const showSettings = ref(false)
</script>

<template>
  <button class="settings-trigger" @click="showSettings = true" title="Settings">
    ⚙ Settings
  </button>

  <PopupWindow v-model="showSettings" title="Settings" :modal="true" width="520px">
    <UserPreferencePanel />
  </PopupWindow>
</template>

<style scoped>
.settings-trigger {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 10px 12px;
  border: none;
  border-top: 1px solid #e5e7eb;
  background: #fff;
  font-size: 12px;
  color: #6b7280;
  font-family: inherit;
  cursor: pointer;
  text-align: left;
}

.settings-trigger:hover {
  background: #f9fafb;
  color: #374151;
}
</style>
