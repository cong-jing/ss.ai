<script setup lang="ts">
import { onMounted } from "vue";
import Button from "../../shared/ui/Button.vue";
import CollapsibleSection from "../../shared/ui/CollapsibleSection.vue";
import TextInput from "../../shared/ui/TextInput.vue";
import { useUserProfileViewModel } from "./useUserProfileViewModel";
import { t } from "../../shared/i18n/i18n";

const { userInfo, isLoadingUser, isSavingUser, loadUserInfo, saveUserInfo } = useUserProfileViewModel();
onMounted(() => {
  void loadUserInfo();
});
</script>

<template>
  <div class="user-profile-panel">
    <CollapsibleSection :title="t('settings.section.userInfo')">
      <div class="section-body">
        <div class="form-group">
          <label>{{ t("settings.name") }}</label>
          <TextInput v-model="userInfo.name" :disabled="isLoadingUser || isSavingUser" :placeholder="t('settings.placeholder.name')" />
        </div>
        <div class="form-group">
          <label>{{ t("settings.profile") }}</label>
          <textarea v-model="userInfo.bio" :disabled="isLoadingUser || isSavingUser" :placeholder="t('settings.placeholder.profile')" rows="3" class="textarea" />
        </div>
        <div class="actions">
          <Button :disabled="isSavingUser || isLoadingUser" @click="saveUserInfo">
            {{ isSavingUser ? t("common.saving") : t("common.save") }}
          </Button>
        </div>
        <p v-if="isLoadingUser" class="hint">{{ t("common.loading") }}</p>
      </div>
    </CollapsibleSection>
  </div>
</template>

<style scoped>
.user-profile-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px;
}

.section-body {
  padding: 12px;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 12px;
}

.form-group label {
  font-size: 12px;
  color: #4b5563;
}

.textarea {
  border: 1px solid #d1d5db;
  border-radius: 8px;
  padding: 8px;
  font-size: 14px;
  font-family: inherit;
  resize: vertical;
  min-height: 72px;
}

.textarea:focus {
  outline: none;
  border-color: #6b7280;
}

.actions {
  display: flex;
  justify-content: flex-end;
}

.hint {
  margin: 4px 0 0;
  font-size: 12px;
  color: #9ca3af;
}
</style>
