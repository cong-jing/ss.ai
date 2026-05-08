<script setup lang="ts">
import { onMounted } from "vue";
import Button from "../../shared/ui/Button.vue";
import CollapsibleSection from "../../shared/ui/CollapsibleSection.vue";
import TextInput from "../../shared/ui/TextInput.vue";
import { useScenarioViewModel } from "./useScenarioViewModel";

const { userInfo, isLoadingUser, isSavingUser, loadUserInfo, saveUserInfo } = useScenarioViewModel();
onMounted(() => { void loadUserInfo(); });
</script>

<template>
  <div class="scenario-panel">
    <CollapsibleSection title="User Info">
      <div class="section-body">
        <div class="form-group">
          <label>Name</label>
          <TextInput v-model="userInfo.name" :disabled="isLoadingUser || isSavingUser" placeholder="Enter your name" />
        </div>
        <div class="form-group">
          <label>Profile</label>
          <textarea v-model="userInfo.bio" :disabled="isLoadingUser || isSavingUser" placeholder="Enter your profile" rows="3" class="textarea" />
        </div>
        <div class="actions">
          <Button :disabled="isSavingUser || isLoadingUser" @click="saveUserInfo">
            {{ isSavingUser ? 'Saving...' : 'Save' }}
          </Button>
        </div>
        <p v-if="isLoadingUser" class="hint">Loading...</p>
      </div>
    </CollapsibleSection>
  </div>
</template>

<style scoped>
.scenario-panel { display: flex; flex-direction: column; gap: 12px; padding: 12px; }
.section-body { padding: 12px; }
.form-group { display: flex; flex-direction: column; gap: 6px; margin-bottom: 12px; }
.form-group label { font-size: 12px; color: #4b5563; }
.textarea { border: 1px solid #d1d5db; border-radius: 8px; padding: 8px; font-size: 14px; font-family: inherit; resize: vertical; min-height: 72px; }
.textarea:focus { outline: none; border-color: #6b7280; }
.actions { display: flex; justify-content: flex-end; }
.hint { margin: 4px 0 0; font-size: 12px; color: #9ca3af; }
</style>
