<script setup lang="ts">
import { ref } from 'vue'
import PopupWindow from '../../shared/ui/PopupWindow.vue'
import UserPreferencePanel from './UserPreferencePanel.vue'
import { t } from "../../shared/i18n/i18n";

const showSettings = ref(false)
</script>

<template>
  <button class="settings-trigger" @click="showSettings = true" :title="t('settings.title')">
    ⚙ {{ t("settings.title") }}
  </button>

  <PopupWindow v-model="showSettings" :title="t('settings.title')" :modal="true" width="520px">
    <UserPreferencePanel />
  </PopupWindow>
</template>

<style scoped>
.settings-trigger {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  min-height: 40px;
  padding: 10px 12px;
  border: none;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
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
