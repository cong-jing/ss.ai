<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import Button from "../../shared/ui/Button.vue";
import CollapsibleSection from "../../shared/ui/CollapsibleSection.vue";
import TextInput from "../../shared/ui/TextInput.vue";
import { useUserProfileViewModel } from "./useUserProfileViewModel";
import { t } from "../../shared/i18n/i18n";
import { useAuthState } from "../../auth/useAuthState";
import { localizeApiError } from "../../shared/api/localizeApiError";
import { useToast } from "../../shared/ui/useToast";

const { userInfo, isLoadingUser, isSavingUser, loadUserInfo, saveUserInfo } = useUserProfileViewModel();
const { authMode, logout } = useAuthState();
const toast = useToast();
const isLoggingOut = ref(false);
const showLogout = computed(() => authMode.value === "local-password");

onMounted(() => {
  void loadUserInfo();
});

async function onLogout(): Promise<void> {
  if (isLoggingOut.value) return;
  isLoggingOut.value = true;
  try {
    await logout();
  } catch (error) {
    toast.error(localizeApiError(error));
  } finally {
    isLoggingOut.value = false;
  }
}
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
          <Button v-if="showLogout" variant="danger" :disabled="isLoggingOut" @click="onLogout">
            {{ isLoggingOut ? t("auth.signingOut") : t("auth.logout") }}
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
  gap: 8px;
  justify-content: flex-end;
}

.hint {
  margin: 4px 0 0;
  font-size: 12px;
  color: #9ca3af;
}
</style>
